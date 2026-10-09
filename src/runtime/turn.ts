import { renderSystemPrompt } from "../agents/agent-loader";
import { renderSkillPrompt } from "../skills/loader";
import { injectProjectPrefix } from "../projects/context";
import type { ProjectContext } from "../projects/context";
import type { AgentDefinition } from "../agents/types";
import type { Skill } from "../skills/types";
import { buildConversationPayload } from "../orchestrator/conversation";
import type { ConversationMessage } from "../orchestrator/conversation";
import { RAG_DEFAULTS } from "../constants";
import { buildEffectiveReadScope } from "./permissions";
import type {
  ChatPort,
  EmbedderPort,
  KgExpanderPort,
  TracerPort,
  VectorStorePort,
  WebSearchPort,
} from "./ports";
import {
  formatRetrievedContext,
  resolveSealedEmbedIdentity,
  retrieveContextChunks,
} from "./retrieval";

/** DEC-0022: user-visible notifications are injected by the Obsidian adapter only. */
export type TurnNotifyFn = (message: string, durationMs?: number) => void;

export interface PortableTurnInput {
  userInput: string;
  skipRag?: boolean;
  /** Undefined = no extra selection layer; [] denies reads. */
  selectionPaths?: string[] | undefined;
  agent: AgentDefinition;
  projectContext?: ProjectContext;
  skillContext?: Skill;
  conversationMessages?: ConversationMessage[];
  conversationSummary?: string;
  traceId?: string;
  tavilyQuery?: string;
  ports: {
    chat: ChatPort;
    embedder: EmbedderPort;
    vectorStore: VectorStorePort;
    tracer?: TracerPort;
    kg?: KgExpanderPort;
    webSearch?: WebSearchPort;
  };
  notify?: TurnNotifyFn;
}

export interface PortableTurnResult {
  content: string;
  usage: { prompt: number; completion: number };
  ragContext: string;
  conversationSummary?: string;
  projectId?: string;
  provenance?: string;
}

function hasWebSearchTool(agent: AgentDefinition, skill?: Skill): boolean {
  return agent.tools?.includes("web_search") || skill?.tools?.includes("web_search") || false;
}

/**
 * DEC-0022: portable agent turn — authorize before embed/KG/traces; threshold without fallback.
 */
export async function runPortableTurn(input: PortableTurnInput): Promise<PortableTurnResult> {
  const {
    userInput,
    skipRag = false,
    selectionPaths,
    agent,
    projectContext,
    skillContext,
    conversationMessages,
    conversationSummary,
    traceId,
    tavilyQuery,
    ports,
    notify,
  } = input;

  const project = projectContext?.project;
  const readScope = buildEffectiveReadScope({
    projectReadPaths: project?.read_paths ?? null,
    agentReadPaths: agent?.permissions?.read_paths,
    selectionPaths,
  });

  const topK = project?.rag?.top_k ?? RAG_DEFAULTS.TOP_K;
  const minSim = project?.rag?.min_similarity ?? RAG_DEFAULTS.MIN_SIMILARITY;

  let ragContext = "";

  if (!skipRag && readScope.allowed && ports.embedder.hasKeys && ports.vectorStore.count > 0) {
    const queryIdentity = resolveSealedEmbedIdentity(project?.rag, ports.vectorStore.identity);
    if (!queryIdentity) {
      notify?.("⚠ RAG: proyecto sin modelo de embedding sellado", 5000);
    } else {
      const queryEmbedding = await ports.embedder.embed(userInput, {
        model: queryIdentity.embedModel,
      });
      const { chunks, skipReason } = retrieveContextChunks({
        queryEmbedding,
        queryIdentity,
        store: ports.vectorStore,
        scope: readScope,
        topK,
        minSimilarity: minSim,
        kg: ports.kg,
        traceId,
        tracer: ports.tracer,
      });

      if (skipReason === "identity_mismatch") {
        notify?.("⚠ RAG: índice incompatible con el modelo/dimensiones del proyecto", 8000);
      } else if (chunks.length === 0 && skipReason !== "scope_denied") {
        notify?.("⚠ RAG: 0 resultados bajo el umbral de similitud configurado", 6000);
      }

      ragContext = formatRetrievedContext(chunks);
    }
  } else if (!skipRag) {
    if (!readScope.allowed) {
      // DEC-0022: no logs/traces of unauthorized paths when scope denies embed/read.
    } else if (!ports.embedder.hasKeys) {
      notify?.("⚠ RAG: sin Gemini API keys", 5000);
    } else if (ports.vectorStore.count === 0) {
      notify?.("⚠ RAG: store vacío. Indexá desde el proyecto.", 8000);
    }
  }

  let webContext = "";
  if (hasWebSearchTool(agent, skillContext) && ports.webSearch) {
    notify?.("🌐 Buscando en web vía Tavily...", 2000);
    try {
      const searchQuery = tavilyQuery || userInput.slice(0, 400);
      webContext = await ports.webSearch.search(searchQuery);
    } catch {
      // DEC-0022: portable core does not log denied or failed web paths.
    }
  }

  let renderedPrompt = renderSystemPrompt(agent, ragContext, userInput);
  renderedPrompt = renderedPrompt.replace(/\{\{web_context\}\}/g, webContext || "");

  if (projectContext?.systemPrefix) {
    renderedPrompt = injectProjectPrefix(renderedPrompt, projectContext.systemPrefix);
  }

  if (skillContext?.instructions) {
    const renderedSkill = renderSkillPrompt(skillContext, ragContext, webContext, userInput);
    renderedPrompt = `--- Skill: ${skillContext.name} ---\n${renderedSkill}\n\n---\n\n${renderedPrompt}`;
  }

  let result: { content: string; usage: { prompt: number; completion: number } };
  if (conversationMessages && conversationMessages.length > 0) {
    const allMessages: ConversationMessage[] = [
      ...conversationMessages,
      { role: "user", content: userInput },
    ];
    const payload = buildConversationPayload(renderedPrompt, allMessages, conversationSummary);
    result = await ports.chat.chatMessages(payload.messages);
    return {
      content: result.content,
      usage: result.usage,
      ragContext,
      conversationSummary: payload.newSummary,
      projectId: project?.id,
      provenance: ports.vectorStore.identity?.provenance,
    };
  }

  result = await ports.chat.chat(renderedPrompt, userInput, ragContext || undefined);
  return {
    content: result.content,
    usage: result.usage,
    ragContext,
    projectId: project?.id,
    provenance: ports.vectorStore.identity?.provenance,
  };
}
