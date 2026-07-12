import { Notice } from "obsidian";
import type { AppServices } from "./services";
import { executeTurn } from "../orchestrator/agent-turn";
import { loadAgentFromVault } from "../agents/agent-loader";
import { executeWriteIntent as executeWriteIntentFromNoteGen } from "../orchestrator/note-generator";
import { classifyIntent, detectPendingAction, buildConversationPayload } from "../orchestrator/conversation";
import { executeChain, topologicalOrder } from "../chains/executor";
import type { ConversationMessage } from "../orchestrator/conversation";
import type { PendingAction, CreatedNote } from "../projects/types";
import { resolveNoteReference } from "../orchestrator/note-resolver";

export interface ChatResponse {
  content: string;
  conversationSummary?: string;
}

/**
 * Encapsulates the message-processing pipeline:
 * mention → chain → pending action → forager pipeline → executeTurn → persistence
 */
export class ChatOrchestrator {
  constructor(private svc: AppServices) {}

  async handleMessage(
    userMessage: string,
    convMessages?: any[],
    convSummary?: string,
  ): Promise<ChatResponse> {
    if (!this.svc.opencodeClient.configured) return { content: "OPENCODE_GO_API_KEY no configurada." };

    // 1. Resolve pending action (confirmation/rejection of a previous offer)
    const pendingResult = await this.tryResolvePendingAction(userMessage, convMessages, convSummary);
    if (pendingResult) return pendingResult;

    // 2. Write intent detection
    const writeIntent = await this.executeWriteIntent(userMessage);
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
            this.buildTurnDeps(chainMsg),
            async (agentId) => {
              try { return await loadAgentFromVault(this.svc.adapter, `${agentId}.md`); }
              catch { return { id: "fallback", name: "Fallback", avatar: "🤖", model: "deepseek-v4-flash", description: "", triggers: [], tools: [], permissions: { read_paths: [], write_paths: [] }, system_prompt: "" }; }
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
      return this.handleImplicitMessage(userMessage, convMessages, convSummary);
    }
    return this.handleAgentMessage(userMessage, mentionMatch, convMessages, convSummary);
  }

  private async handleImplicitMessage(
    userMessage: string,
    convMessages?: any[],
    convSummary?: string,
  ): Promise<ChatResponse> {
    // Load orchestrator and build context
    let orchestratorPrompt = "";
    try {
      const orch = await loadAgentFromVault(this.svc.adapter, "orchestrator.md");
      orchestratorPrompt = orch.system_prompt.replace("{{user_prompt}}", JSON.stringify({
        mode: "implicit",
        userMessage,
        historySummary: convSummary || "(sin historial previo)",
        createdNotes: (this.svc.activeProject && this.svc.activeThreadId)
          ? (await this.svc.projectStore.loadThreadData(this.svc.activeProject.id, this.svc.activeThreadId).catch(() => null))?.createdNotes?.map(n => n.title) || []
          : [],
      }, null, 2));
    } catch {
      // No orchestrator → treat as normal agent query
      return this.handleAgentMessage(userMessage, null, convMessages, convSummary);
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
        return this.handleAgentMessage(userMessage, null, convMessages, convSummary);
      }
      if (action === "create_note") {
        const name = userMessage.slice(0, 40).replace(/[^a-zA-Z0-9áéíóúñ\s-]/g, "").trim() || "nota";
        const content = await this.createNoteFromIntent(name, userMessage);
        return { content };
      }
      if (action === "modify_note") {
        const threadData = (this.svc.activeProject && this.svc.activeThreadId)
          ? await this.svc.projectStore.loadThreadData(this.svc.activeProject.id, this.svc.activeThreadId).catch(() => null)
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
        try {
          const currentContent = await this.svc.adapter.read(resolution.path!);
          const modPrompt = `Nota actual:\n${currentContent.slice(0, 3000)}\n\nInstrucción del usuario: ${userMessage}\n\nRegenerá la nota completa incorporando los cambios pedidos. Responde SOLO con el contenido Markdown completo de la nota modificada.`;
          const agent = this.svc.agent || this.fallbackAgent();
          const result = await executeTurn(
            { ...this.buildTurnDeps(modPrompt), agent, tavilyQuery: undefined, conversationMessages: undefined, conversationSummary: undefined },
            modPrompt,
            true,
            this.svc.pathFilter,
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
    return this.handleAgentMessage(userMessage, null, convMessages, convSummary);
  }

  private async tryResolvePendingAction(
    userMessage: string,
    convMessages?: any[],
    convSummary?: string,
  ): Promise<ChatResponse | null> {
    if (!this.svc.activeThreadId || !this.svc.activeProject) return null;
    const data = await this.svc.projectStore.loadThreadData(this.svc.activeProject.id, this.svc.activeThreadId).catch(() => null);
    if (!data?.pendingAction) return null;

    const intent = classifyIntent(userMessage, data.pendingAction);
    if (intent.type === "rejection") {
      data.pendingAction = undefined;
      await this.svc.projectStore.saveThreadData(this.svc.activeProject.id, data.thread, data.messages || [], data);
      return { content: "👍 Ok, no se realiza la acción." };
    }

    if (intent.type === "confirmation") {
      const pa = data.pendingAction;
      data.pendingAction = undefined;
      if (pa.type === "create_note") {
        const agent = this.svc.agent || this.fallbackAgent();
        const noteName = pa.params.noteName || pa.params.title || "nota";
        try {
          const result = await executeWriteIntentFromNoteGen(
            {
              agent,
              opencodeClient: this.svc.opencodeClient,
              noteWriter: this.svc.noteWriter,
              tracer: this.svc.tracer,
              vaultAdapter: this.svc.adapter,
              writePaths: this.svc.activeProject?.write_paths || [],
              outputPath: this.svc.activeProject?.outputPath,
            },
            { name: noteName, topic: pa.params.fullProposal || pa.description || noteName },
          );
          if (!data.createdNotes) data.createdNotes = [];
          const created: CreatedNote = { path: `Projects/${this.svc.activeProject.id}/${noteName}.md`, title: noteName, created_at: Date.now() };
          data.createdNotes.push(created);
          await this.svc.projectStore.saveThreadData(this.svc.activeProject.id, data.thread, data.messages || [], data);
          return { content: result };
        } catch (err: any) {
          return { content: `Error al crear nota: ${err.message}` };
        }
      }
      if (pa.type === "research") {
        const followUp = pa.params.fullProposal || pa.description || "profundizar";
        return this.handleAgentMessage(followUp, null, convMessages, convSummary);
      }
    }

    return null;
  }

  private async handleAgentMessage(
    userMessage: string,
    mentionMatch: RegExpMatchArray | null,
    convMessages?: any[],
    convSummary?: string,
  ): Promise<ChatResponse> {
    let agent = this.svc.agent || this.fallbackAgent();
    let actualMessage = userMessage;

    if (mentionMatch) {
      const targetAgentId = mentionMatch[1];
      try {
        agent = await loadAgentFromVault(this.svc.adapter, `${targetAgentId}.md`);
        actualMessage = mentionMatch[2]?.trim() || "Presentate y saludame.";
      } catch {}
    }

    const originalQuery = actualMessage;

    // ── Forager pipeline (for web-search / researcher) ──
    if ((mentionMatch?.[1] === "web-search" || mentionMatch?.[1] === "researcher") && actualMessage.length > 0) {
      try {
        const forager = await loadAgentFromVault(this.svc.adapter, "forager.md");
        const foragerDeps = { ...this.buildTurnDeps(actualMessage), agent: forager, tavilyApiKey: undefined, tavilyQuery: undefined };
        const foragerResult = await executeTurn(foragerDeps, actualMessage, false, this.svc.pathFilter);
        const refined = foragerResult.content.slice(0, 4000);
        actualMessage = `${refined}\n\n---\nPregunta original del usuario: ${originalQuery}\n\nResponde usando el contexto recopilado${mentionMatch[1] === "web-search" ? " y la búsqueda web" : ""}.`;
      } catch {}
    }

    const convMsgs = convMessages?.filter(m => m.role !== "system");
    const deps = { ...this.buildTurnDeps(actualMessage), agent, tavilyQuery: originalQuery, conversationMessages: convMsgs, conversationSummary: convSummary || undefined };

    const result = await executeTurn(deps, actualMessage, false, this.svc.pathFilter);

    // Persist summary and pending action
    await this.persistThreadData(actualMessage, result);

    return { content: result.content, conversationSummary: result.conversationSummary };
  }

  private buildTurnDeps(userInput: string) {
    return {
      opencodeClient: this.svc.opencodeClient,
      geminiBalancer: this.svc.geminiBalancer,
      vectorStore: this.svc.vectorStore,
      tracer: this.svc.tracer,
      tavilyApiKey: this.svc.settings?.tavilyApiKey,
      kgOptions: this.svc.kgOptions,
      edgeStore: this.svc.kgEdgeStore,
      projectContext: this.svc.activeProjectContext || undefined,
      skillContext: this.svc.skillContext || undefined,
    };
  }

  private async persistThreadData(actualMessage: string, result: { conversationSummary?: string; content: string }): Promise<void> {
    if (this.svc.activeThreadId && this.svc.activeProject) {
      const { detectPendingAction } = await import("../orchestrator/conversation");
      const data = await this.svc.projectStore.loadThreadData(this.svc.activeProject.id, this.svc.activeThreadId).catch(() => null);
      if (data) {
        if (result.conversationSummary) data.summary = result.conversationSummary;
        const action = detectPendingAction(result.content);
        if (action) data.pendingAction = action;
        await this.svc.projectStore.saveThreadData(this.svc.activeProject.id, data.thread, data.messages || [], data);
      }
    }
  }

  private async executeWriteIntent(userMessage: string): Promise<string | null> {
    const nameMatch = userMessage.toLowerCase().match(/cre[áa]\s*una\s+nota\s+llamada\s+["']?([^"'\n]+)["']?\s*(?:sobre\s+)?(.+)?/i);
    const topicMatch = !nameMatch ? userMessage.toLowerCase().match(/cre[áa]\s*una\s+nota\s+(?:sobre\s+)?(.+)/i) : null;
    if (!nameMatch && !topicMatch) return null;
    const intent = nameMatch
      ? { name: nameMatch[1].trim(), topic: nameMatch[2]?.trim() || nameMatch[1].trim() }
      : { topic: topicMatch![1].trim() };
    return await this.createNoteFromIntent(intent.name || intent.topic!, intent.topic!);
  }

  /**
   * Core note creation: executes the LLM call and registers createdNotes.
   * No regex parsing — trusts the caller has already classified the intent.
   * Used by executeWriteIntent (regex path) and handleImplicitMessage (orchestrator path).
   */
  private async createNoteFromIntent(name: string, topic: string): Promise<string> {
    const agent = this.svc.agent || this.fallbackAgent();
    try {
      const result = await executeWriteIntentFromNoteGen(
        {
          agent,
          opencodeClient: this.svc.opencodeClient,
          noteWriter: this.svc.noteWriter,
          tracer: this.svc.tracer,
          vaultAdapter: this.svc.adapter,
          writePaths: this.svc.activeProject?.write_paths || [],
          outputPath: this.svc.activeProject?.outputPath,
        },
        { name, topic },
      );
      if (this.svc.activeThreadId && this.svc.activeProject) {
        const data = await this.svc.projectStore.loadThreadData(this.svc.activeProject.id, this.svc.activeThreadId).catch(() => null);
        if (data) {
          if (!data.createdNotes) data.createdNotes = [];
          data.createdNotes.push({ path: `${this.svc.activeProject.outputPath}/${name}.md`, title: name, created_at: Date.now() });
          await this.svc.projectStore.saveThreadData(this.svc.activeProject.id, data.thread, data.messages || [], data);
        }
      }
      return result;
    } catch (err: any) {
      return `Error al crear nota: ${err.message}`;
    }
  }

  private fallbackAgent() {
    return {
      id: "fallback", name: "Fallback", avatar: "🤖", model: "deepseek-v4-flash",
      description: "", triggers: [], tools: [], permissions: { read_paths: [], write_paths: [] },
      system_prompt: "Eres un asistente útil.",
    };
  }
}
