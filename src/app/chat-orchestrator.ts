import { Notice } from "obsidian";
import type { AppServices } from "./services";
import { executeTurn } from "../orchestrator/agent-turn";
import { loadAgentFromVault } from "../agents/agent-loader";
import { fallbackAgent } from "../agents/fallback";
import { executeWriteIntent as executeWriteIntentFromNoteGen, canWriteToPath } from "../orchestrator/note-generator";
import { classifyIntent, detectPendingAction, buildConversationPayload } from "../orchestrator/conversation";
import { executeChain, topologicalOrder } from "../chains/executor";
import type { ConversationMessage } from "../orchestrator/conversation";
import type { PendingAction, CreatedNote } from "../projects/types";
import { resolveNoteReference } from "../orchestrator/note-resolver";
import { parseWriteIntent } from "../utils";
import { DEFAULT_MODEL, BUILTIN_AGENTS } from "../constants";

export interface ChatResponse {
  content: string;
  conversationSummary?: string;
}

/**
 * Encapsulates the message-processing pipeline:
 * mention → chain → pending action → forager pipeline → executeTurn → persistence
 */
interface RequestSnapshot {
  projectId: string | undefined;
  threadId: string | undefined;
  project: import("../projects/types").Project | null;
  agent: import("../agents/types").AgentDefinition | null;
  pathFilter: string[] | undefined;
  projectContext: import("../projects/context").ProjectContext | null;
  skillContext: import("../skills/types").Skill | null;
}

export class ChatOrchestrator {
  constructor(private svc: AppServices) {}

  private captureContext(): RequestSnapshot {
    return {
      projectId: this.svc.activeProject?.id,
      threadId: this.svc.activeThreadId,
      project: this.svc.activeProject,
      agent: this.svc.agent,
      pathFilter: this.svc.pathFilter,
      projectContext: this.svc.activeProjectContext,
      skillContext: this.svc.skillContext,
    };
  }

  async handleMessage(
    userMessage: string,
    convMessages?: any[],
    convSummary?: string,
  ): Promise<ChatResponse> {
    if (!this.svc.opencodeClient.configured) return { content: "OPENCODE_GO_API_KEY no configurada." };

    const snap = this.captureContext();

    // 1. Resolve pending action (confirmation/rejection of a previous offer)
    const pendingResult = await this.tryResolvePendingAction(userMessage, snap);
    if (pendingResult) return pendingResult;

    // 2. Write intent detection
    const writeIntent = await this.executeWriteIntent(userMessage, snap);
    if (writeIntent) return { content: writeIntent };

    const mentionMatch = userMessage.trim().match(/^@([\w\-]+)(?:\s+([\s\S]*))?$/);
    const mentionName = mentionMatch?.[1];

    // ── Chain detection (@cadena-name) ──
    if (mentionName) {
      const chain = await this.svc.chainStore.load(mentionName).catch(() => null);
      if (chain && chain.nodes.length > 0) {
        const chainMsg = mentionMatch![2]?.trim() || "Ejecutar cadena";
        new Notice(`⛓️ Ejecutando cadena: ${chain.name} (${chain.nodes.length} pasos)`, 3000);
        try {
          const order = topologicalOrder(chain.nodes, chain.edges);
          const result = await executeChain(
            chain,
            this.buildTurnDeps(chainMsg, snap),
            async (agentId) => {
      try { return await loadAgentFromVault(this.svc.adapter, `${agentId}.md`); }
      catch (err: any) { console.warn("[Chain] Agent load failed:", err.message); return { id: "fallback", name: "Fallback", avatar: "🤖", model: DEFAULT_MODEL, description: "", triggers: [], tools: [], permissions: { read_paths: [], write_paths: [] }, system_prompt: "" }; }
            },
            chainMsg,
          );
          return { content: `⛓️ Cadena "${chain.name}" (${order.length} pasos):\n\n${result.finalOutput}` };
        } catch (err: any) {
          return { content: `⛓️ Error: ${err.message}` };
        }
      }
    }

    // ── Agent flow ──
    if (!mentionMatch) {
      return this.handleImplicitMessage(userMessage, convMessages, convSummary, snap);
    }
    return this.handleAgentMessage(userMessage, mentionMatch, convMessages, convSummary, snap);
  }

  private async handleImplicitMessage(
    userMessage: string,
    convMessages: any[] | undefined,
    convSummary: string | undefined,
    snap: RequestSnapshot,
  ): Promise<ChatResponse> {
    // Load orchestrator and build context
    let orchestratorPrompt = "";
    try {
      const orch = await loadAgentFromVault(this.svc.adapter, `${BUILTIN_AGENTS.ORCHESTRATOR}.md`);
      // Build recent conversation context from convMessages
      let recentContext = convSummary || "";
      if (!recentContext && convMessages && convMessages.length > 0) {
        const lastMsgs = convMessages.slice(-4).map((m: any) =>
          `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 300)}`
        ).join("\n");
        recentContext = lastMsgs || "(sin historial previo)";
      }
      orchestratorPrompt = orch.system_prompt.replace("{{user_prompt}}", JSON.stringify({
        mode: "implicit",
        userMessage,
        historySummary: recentContext || "(sin historial previo)",
        createdNotes: (snap.projectId && snap.threadId)
          ? (await this.svc.projectStore.loadThreadData(snap.projectId, snap.threadId).catch(() => null))?.createdNotes?.map(n => n.title) || []
          : [],
      }, null, 2));
    } catch (err: any) {
      console.warn("[Orchestrator] load failed, falling back to direct agent:", err.message);
      return this.handleAgentMessage(userMessage, null, convMessages, convSummary, snap);
    }

    try {
      const result = await this.svc.opencodeClient.chat(orchestratorPrompt, userMessage);
      const jsonStr = result.content.slice(
        result.content.indexOf("{"),
        result.content.lastIndexOf("}") + 1,
      );
      const decision = JSON.parse(jsonStr);
      const action = decision.action;
      new Notice(`🎯 Orquestador: ${action}`, 2000);
      console.log(`[Orchestrator] implicit decision: ${action} — ${decision.reason}`);

      if (action === "respond_only") {
        return this.handleAgentMessage(userMessage, null, convMessages, convSummary, snap);
      }
      if (action === "create_note") {
        const noteName = (decision.noteName || userMessage.slice(0, 40))
          .replace(/[^a-zA-Z0-9áéíóúñ\s-]/g, "").trim() || "nota";
        const content = await this.createNoteFromIntent(noteName, userMessage, snap);
        return { content };
      }
      if (action === "modify_note") {
        const noteName = decision.noteName; // optional, used by resolver
        const threadData = (snap.projectId && snap.threadId)
          ? await this.svc.projectStore.loadThreadData(snap.projectId, snap.threadId).catch(() => null)
          : null;
        const resolution = await resolveNoteReference(
          userMessage,
          threadData?.createdNotes,
          this.svc.vectorStore,
          this.svc.geminiBalancer,
        );
        if (resolution.method === "not_found") {
          return { content: "No encontré ninguna nota que coincida. ¿Podrías decirme el nombre exacto?" };
        }
        if (resolution.method === "ambiguous") {
          const names = resolution.candidates!.map(c => c.title).join(", ");
          return { content: `Encontré varias notas posibles: ${names}. ¿A cuál te referís?` };
        }
        // Note resolved — modify it
        if (!canWriteToPath(resolution.path!, snap.project?.write_paths || [])) {
          return { content: `Permiso denegado: no se puede modificar ${resolution.path}` };
        }
        try {
          const currentContent = await this.svc.adapter.read(resolution.path!);
          const modPrompt = `Nota actual:\n${currentContent.slice(0, 3000)}\n\nInstrucción del usuario: ${userMessage}\n\nRegenerá la nota completa incorporando los cambios pedidos. Responde SOLO con el contenido Markdown completo de la nota modificada.`;
          const agent = snap.agent || fallbackAgent();
          const result = await executeTurn(
            { ...this.buildTurnDeps(modPrompt, snap), agent, tavilyQuery: undefined, conversationMessages: undefined, conversationSummary: undefined },
            modPrompt,
            true,
            snap.pathFilter,
          );
          const wr = await this.svc.noteWriter.update(resolution.path!, result.content);
          return { content: `✏️ **${wr.message}**\n\n${result.content.slice(0, 300)}…` };
        } catch (err: any) {
          return { content: `Error al modificar nota: ${err.message}` };
        }
      }
      if (action === "clarify") {
        return { content: "¿Podrías darme más detalles sobre qué querés hacer? ¿Crear una nota nueva, modificar una existente, o solo consultar algo?" };
      }
    } catch (err: any) {
      console.warn("[Orchestrator] implicit parse failed:", err.message);
    }
    // Fallback: treat as normal agent query
    return this.handleAgentMessage(userMessage, null, convMessages, convSummary, snap);
  }

  private async tryResolvePendingAction(
    userMessage: string,
    snap: RequestSnapshot,
  ): Promise<ChatResponse | null> {
    if (!snap.threadId || !snap.projectId) return null;
    const data = await this.svc.projectStore.loadThreadData(snap.projectId, snap.threadId).catch(() => null);
    if (!data?.pendingAction) return null;

    const intent = classifyIntent(userMessage, data.pendingAction);
    const projectId = snap.projectId;
    const threadId = snap.threadId;

    if (intent.type === "rejection") {
      await this.svc.projectStore.patchThreadData(projectId, threadId, d => { d.pendingAction = undefined; return d; });
      return { content: "👍 Ok, no se realiza la acción." };
    }

    if (intent.type === "confirmation") {
      const pa = data.pendingAction;
      await this.svc.projectStore.patchThreadData(projectId, threadId, d => { d.pendingAction = undefined; return d; });
      if (pa.type === "create_note") {
        const agent = snap.agent || fallbackAgent();
        const noteName = pa.params.noteName || pa.params.title || "nota";
        try {
          const result = await executeWriteIntentFromNoteGen(
            {
              agent,
              opencodeClient: this.svc.opencodeClient,
              noteWriter: this.svc.noteWriter,
              tracer: this.svc.tracer,
              vaultAdapter: this.svc.adapter,
              writePaths: snap.project?.write_paths || [],
              outputPath: snap.project?.outputPath,
            },
            { name: noteName, topic: pa.params.fullProposal || pa.description || noteName },
          );
          await this.svc.projectStore.patchThreadData(projectId, threadId, d => {
            if (!d.createdNotes) d.createdNotes = [];
            d.createdNotes.push({ path: `${snap.project?.outputPath || "Research"}/${noteName}.md`, title: noteName, created_at: Date.now() });
            return d;
          });
          return { content: result };
        } catch (err: any) {
          return { content: `Error al crear nota: ${err.message}` };
        }
      }
      if (pa.type === "research") {
        const followUp = pa.params.fullProposal || pa.description || "profundizar";
        return this.handleAgentMessage(followUp, null, undefined, undefined, snap);
      }
    }

    return null;
  }

  private async handleAgentMessage(
    userMessage: string,
    mentionMatch: RegExpMatchArray | null,
    convMessages: any[] | undefined,
    convSummary: string | undefined,
    snap: RequestSnapshot,
  ): Promise<ChatResponse> {
    let agent = snap.agent || fallbackAgent();
    let actualMessage = userMessage;

    if (mentionMatch) {
      const targetAgentId = mentionMatch[1];
      try {
        agent = await loadAgentFromVault(this.svc.adapter, `${targetAgentId}.md`);
        actualMessage = mentionMatch[2]?.trim() || "Presentate y saludame.";
      } catch (err: any) {
        console.warn(`[Agent] @mention agent "${targetAgentId}" not found, using default:`, err.message);
      }
    }

    const originalQuery = actualMessage;

    // ── Forager pipeline (for web-search / researcher) ──
    if ((mentionMatch?.[1] === "web-search" || mentionMatch?.[1] === "researcher") && actualMessage.length > 0) {
      try {
        const forager = await loadAgentFromVault(this.svc.adapter, `${BUILTIN_AGENTS.FORAGER}.md`);
        const foragerDeps = { ...this.buildTurnDeps(actualMessage, snap), agent: forager, tavilyApiKey: undefined, tavilyQuery: undefined };
        const foragerResult = await executeTurn(foragerDeps, actualMessage, false, snap.pathFilter);
        const refined = foragerResult.content.slice(0, 4000);
        actualMessage = `${refined}\n\n---\nPregunta original del usuario: ${originalQuery}\n\nResponde usando el contexto recopilado${mentionMatch[1] === "web-search" ? " y la búsqueda web" : ""}.`;
      } catch (err: any) {
        console.warn("[Forager] pipeline failed, proceeding without forager context:", err.message);
      }
    }

    const convMsgs = convMessages?.filter(m => m.role !== "system");
    const deps = { ...this.buildTurnDeps(actualMessage, snap), agent, tavilyQuery: originalQuery, conversationMessages: convMsgs, conversationSummary: convSummary || undefined };

    const result = await executeTurn(deps, actualMessage, false, snap.pathFilter);

    // Persist summary and pending action using the captured context
    await this.persistThreadData(snap.projectId, snap.threadId, result);

    return { content: result.content, conversationSummary: result.conversationSummary };
  }

  private buildTurnDeps(userInput: string, snap: RequestSnapshot) {
    return {
      opencodeClient: this.svc.opencodeClient,
      geminiBalancer: this.svc.geminiBalancer,
      vectorStore: this.svc.vectorStore,
      tracer: this.svc.tracer,
      tavilyApiKey: this.svc.settings?.tavilyApiKey,
      kgOptions: this.svc.kgOptions,
      edgeStore: this.svc.kgEdgeStore,
      projectContext: snap.projectContext || undefined,
      skillContext: snap.skillContext || undefined,
    };
  }

  private async persistThreadData(projectId: string | undefined, threadId: string | undefined, result: { conversationSummary?: string; content: string }): Promise<void> {
    if (threadId && projectId) {
      await this.svc.projectStore.patchThreadData(projectId, threadId, d => {
        if (result.conversationSummary) d.summary = result.conversationSummary;
        const action = detectPendingAction(result.content);
        if (action) d.pendingAction = action;
        return d;
      });
    }
  }

  private async executeWriteIntent(userMessage: string, snap: RequestSnapshot): Promise<string | null> {
    const intent = parseWriteIntent(userMessage);
    if (!intent) return null;
    return await this.createNoteFromIntent(intent.name || intent.topic!, intent.topic!, snap);
  }

  private async createNoteFromIntent(name: string, topic: string, snap: RequestSnapshot): Promise<string> {
    const agent = snap.agent || fallbackAgent();
    try {
      const result = await executeWriteIntentFromNoteGen(
        {
          agent,
          opencodeClient: this.svc.opencodeClient,
          noteWriter: this.svc.noteWriter,
          tracer: this.svc.tracer,
          vaultAdapter: this.svc.adapter,
          writePaths: snap.project?.write_paths || [],
          outputPath: snap.project?.outputPath,
        },
        { name, topic },
      );
      if (snap.threadId && snap.projectId) {
        await this.svc.projectStore.patchThreadData(snap.projectId, snap.threadId, d => {
          if (!d.createdNotes) d.createdNotes = [];
          d.createdNotes.push({ path: `${snap.project?.outputPath || "Research"}/${name}.md`, title: name, created_at: Date.now() });
          return d;
        });
      }
      return result;
    } catch (err: any) {
      return `Error al crear nota: ${err.message}`;
    }
  }

}
