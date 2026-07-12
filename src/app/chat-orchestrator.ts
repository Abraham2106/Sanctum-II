import { Notice } from "obsidian";
import type { AppServices } from "./services";
import { executeTurn } from "../orchestrator/agent-turn";
import { loadAgentFromVault } from "../agents/agent-loader";
import { executeWriteIntent as executeWriteIntentFromNoteGen } from "../orchestrator/note-generator";
import { classifyIntent, detectPendingAction, buildConversationPayload } from "../orchestrator/conversation";
import { executeChain, topologicalOrder } from "../chains/executor";
import type { ConversationMessage } from "../orchestrator/conversation";

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
    return this.handleAgentMessage(userMessage, mentionMatch, convMessages, convSummary);
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
        const refined = foragerResult.content.slice(0, 2000);
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
        await this.svc.projectStore.saveThreadData(this.svc.activeProject.id, data.thread, data.messages || []);
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
    const agent = this.svc.agent || this.fallbackAgent();
    try {
      return await executeWriteIntentFromNoteGen(
        {
          agent,
          opencodeClient: this.svc.opencodeClient,
          noteWriter: this.svc.noteWriter,
          tracer: this.svc.tracer,
          vaultAdapter: this.svc.adapter,
          writePaths: agent.permissions?.write_paths || [],
        },
        intent,
      );
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
