import { Notice } from "obsidian";
import type { AppServices, RequestSnapshot } from "./services";
import { executeTurn } from "../orchestrator/agent-turn";
import { loadAgentFromVault } from "../agents/agent-loader";
import { fallbackAgent } from "../agents/fallback";
import { detectPendingAction } from "../orchestrator/conversation";
import { executeChain, topologicalOrder } from "../chains/executor";
import type { ConversationMessage } from "../orchestrator/conversation";
import { DEFAULT_MODEL, BUILTIN_AGENTS } from "../constants";
import { tryResolvePendingAction, createNoteFromOrchestratorDecision } from "./pending-turn";
import { executeWriteIntentMessage, modifyNoteFromIntent } from "./write-turn";

export interface ChatResponse {
  content: string;
  conversationSummary?: string;
}

export class ChatOrchestrator {
  constructor(private svc: AppServices) {}

  cancelInFlightChat(): void {
    this.svc.cancelChatRequest();
  }

  async handleMessage(
    userMessage: string,
    convMessages?: ConversationMessage[],
    convSummary?: string,
  ): Promise<ChatResponse> {
    if (!this.svc.opencodeClient.configured) {
      return { content: "OPENCODE_GO_API_KEY no configurada." };
    }

    const snap = this.svc.captureRequestSnapshot();

    try {
      const pendingResult = await tryResolvePendingAction(
        this.svc,
        userMessage,
        snap,
        (followUp, pendingSnap) =>
          this.handleAgentMessage(followUp, null, convMessages, convSummary, pendingSnap),
      );
      if (pendingResult) return pendingResult;

      const writeIntent = await executeWriteIntentMessage(this.svc, userMessage, snap, convMessages);
      if (writeIntent) return { content: writeIntent };

      const mentionMatch = userMessage.trim().match(/^@([\w\-]+)(?:\s+([\s\S]*))?$/);
      const mentionName = mentionMatch?.[1];

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
                try {
                  return await loadAgentFromVault(this.svc.adapter, `${agentId}.md`);
                } catch (err: any) {
                  console.warn("[Chain] Agent load failed:", err.message);
                  return {
                    id: "fallback",
                    name: "Fallback",
                    avatar: "🤖",
                    model: DEFAULT_MODEL,
                    description: "",
                    triggers: [],
                    tools: [],
                    permissions: { read_paths: [], write_paths: [] },
                    system_prompt: "",
                  };
                }
              },
              chainMsg,
              snap.pathFilter,
            );
            return {
              content: `⛓️ Cadena "${chain.name}" (${order.length} pasos):\n\n${result.finalOutput}`,
            };
          } catch (err: any) {
            return { content: `⛓️ Error: ${err.message}` };
          }
        }
      }

      if (!mentionMatch) {
        return this.handleImplicitMessage(userMessage, convMessages, convSummary, snap);
      }
      return this.handleAgentMessage(userMessage, mentionMatch, convMessages, convSummary, snap);
    } finally {
      this.svc.clearChatAbort();
    }
  }

  private async handleImplicitMessage(
    userMessage: string,
    convMessages: ConversationMessage[] | undefined,
    convSummary: string | undefined,
    snap: RequestSnapshot,
  ): Promise<ChatResponse> {
    let orchestratorPrompt = "";
    try {
      const orch = await loadAgentFromVault(this.svc.adapter, `${BUILTIN_AGENTS.ORCHESTRATOR}.md`);
      let recentContext = convSummary || "";
      if (!recentContext && convMessages && convMessages.length > 0) {
        const lastMsgs = convMessages
          .slice(-4)
          .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 300)}`)
          .join("\n");
        recentContext = lastMsgs || "(sin historial previo)";
      }
      orchestratorPrompt = orch.system_prompt.replace(
        "{{user_prompt}}",
        JSON.stringify(
          {
            mode: "implicit",
            userMessage,
            historySummary: recentContext || "(sin historial previo)",
            createdNotes:
              snap.projectId && snap.threadId
                ? (
                    await this.svc.projectStore
                      .loadThreadData(snap.projectId, snap.threadId)
                      .catch(() => null)
                  )?.createdNotes?.map((n) => n.title) || []
                : [],
          },
          null,
          2,
        ),
      );
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
        const noteName =
          (decision.noteName || userMessage.slice(0, 40)).replace(/[^a-zA-Z0-9áéíóúñ\s-]/g, "").trim() ||
          "nota";
        const content = await createNoteFromOrchestratorDecision(
          this.svc,
          noteName,
          userMessage,
          snap,
          convMessages,
        );
        return { content };
      }
      if (action === "modify_note") {
        const content = await modifyNoteFromIntent(
          this.svc,
          userMessage,
          typeof decision.noteName === "string" ? decision.noteName : undefined,
          snap,
        );
        return { content };
      }
      if (action === "clarify") {
        return {
          content:
            "¿Podrías darme más detalles sobre qué querés hacer? ¿Crear una nota nueva, modificar una existente, o solo consultar algo?",
        };
      }
    } catch (err: any) {
      console.warn("[Orchestrator] implicit parse failed:", err.message);
    }
    return this.handleAgentMessage(userMessage, null, convMessages, convSummary, snap);
  }

  private async handleAgentMessage(
    userMessage: string,
    mentionMatch: RegExpMatchArray | null,
    convMessages: ConversationMessage[] | undefined,
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

    if (
      (mentionMatch?.[1] === "web-search" || mentionMatch?.[1] === "researcher") &&
      actualMessage.length > 0
    ) {
      try {
        const forager = await loadAgentFromVault(this.svc.adapter, `${BUILTIN_AGENTS.FORAGER}.md`);
        const foragerDeps = {
          ...this.buildTurnDeps(actualMessage, snap),
          agent: forager,
          tavilyApiKey: undefined,
          tavilyQuery: undefined,
        };
        const foragerResult = await executeTurn(
          foragerDeps,
          actualMessage,
          false,
          snap.pathFilter,
        );
        const refined = foragerResult.content.slice(0, 4000);
        actualMessage = `${refined}\n\n---\nPregunta original del usuario: ${originalQuery}\n\nResponde usando el contexto recopilado${mentionMatch[1] === "web-search" ? " y la búsqueda web" : ""}.`;
      } catch (err: any) {
        console.warn("[Forager] pipeline failed, proceeding without forager context:", err.message);
      }
    }

    const convMsgs = convMessages?.filter((m) => m.role !== "system");
    const deps = {
      ...this.buildTurnDeps(actualMessage, snap),
      agent,
      tavilyQuery: originalQuery,
      conversationMessages: convMsgs,
      conversationSummary: convSummary || undefined,
    };

    const result = await executeTurn(deps, actualMessage, false, snap.pathFilter);
    await this.persistThreadData(snap.projectId, snap.threadId, result, agent.id);
    return { content: result.content, conversationSummary: result.conversationSummary };
  }

  private buildTurnDeps(userInput: string, snap: RequestSnapshot) {
    return {
      agent: snap.agent || fallbackAgent(),
      opencodeClient: this.svc.opencodeClient,
      geminiBalancer: snap.geminiBalancer,
      embedder: snap.embedder,
      vectorStore: snap.vectorStore,
      tracer: this.svc.tracer,
      tavilyApiKey: this.svc.settings?.tavilyApiKey,
      kgOptions: snap.kgOptions,
      edgeStore: snap.kgEdgeStore,
      projectContext: snap.projectContext || undefined,
      skillContext: snap.skillContext || undefined,
      sealedGeneration: snap.sealedGeneration,
      signal: snap.chatAbort.signal,
    };
  }

  private async persistThreadData(
    projectId: string | undefined,
    threadId: string | undefined,
    result: { conversationSummary?: string; content: string },
    sourceAgentId?: string,
  ): Promise<void> {
    if (threadId && projectId) {
      await this.svc.projectStore.patchThreadData(projectId, threadId, (d) => {
        if (result.conversationSummary) d.summary = result.conversationSummary;
        const action = detectPendingAction(result.content, { sourceAgentId });
        if (action) d.pendingAction = action;
        return d;
      });
    }
  }
}
