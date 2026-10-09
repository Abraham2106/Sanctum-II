import { Notice } from "obsidian";
import type { AgentDefinition } from "../agents/types";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer, TraceChunk } from "../observability/tracer";
import { searchTavily, formatWebContext } from "../tools/tavily";
import { expandFromSeeds } from "../kg/kg";
import type { KgOptions } from "../kg/types";
import type { KgEdgeStore } from "../kg/kg-store";
import type { ProjectContext } from "../projects/context";
import type { Skill } from "../skills/types";
import type { ConversationMessage } from "./conversation";
import type { ChatMessage } from "../llm/chat-wire";
import type {
  ChatPort,
  EmbedderPort,
  KgExpanderPort,
  TracerPort,
  VectorIdentity,
  VectorStorePort,
  WebSearchPort,
} from "../runtime/ports";
import { runPortableTurn } from "../runtime/turn";
import type { PortableTurnResult } from "../runtime/turn";

export interface TurnDeps {
  agent: AgentDefinition;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  vectorStore: VectorStore;
  tracer: Tracer;
  tavilyApiKey?: string;
  tavilyQuery?: string;
  kgOptions?: KgOptions;
  edgeStore?: KgEdgeStore;
  projectContext?: ProjectContext;
  skillContext?: Skill;
  conversationMessages?: ConversationMessage[];
  conversationSummary?: string;
  traceId?: string;
  /** DEC-0022: optional sealed generation metadata for vector identity checks. */
  sealedGeneration?: VectorIdentity;
}

export interface TurnResult {
  content: string;
  usage: { prompt: number; completion: number };
  ragContext: string;
  conversationSummary?: string;
  projectId?: string;
  provenance?: string;
}

function createChatPort(client: OpenCodeClient): ChatPort {
  return {
    chat: (systemPrompt, userPrompt, injectedContext, options) =>
      client.chat(systemPrompt, userPrompt, injectedContext),
    chatMessages: (messages) => client.chat(messages as ChatMessage[]),
  };
}

function createEmbedderPort(balancer: GeminiBalancer): EmbedderPort {
  return {
    hasKeys: balancer.hasKeys,
    embed: (text, options) => balancer.embed(text),
  };
}

function createTracerPort(tracer: Tracer): TracerPort {
  return {
    addChunk: (traceId, chunk) => tracer.addChunk(traceId, chunk as TraceChunk),
  };
}

function createVectorStorePort(
  store: VectorStore,
  projectContext?: ProjectContext,
  sealedGeneration?: VectorIdentity,
): VectorStorePort {
  const project = projectContext?.project;
  const identity: VectorIdentity | undefined =
    sealedGeneration ??
    (project?.rag
      ? {
          embedModel: project.rag.embed_model,
          dims: project.rag.dims,
        }
      : undefined);

  return {
    count: store.count,
    identity,
    allChunks: () =>
      store.allChunks.map((c) => ({
        id: c.id,
        notePath: c.note_path,
        chunkText: c.chunk_text,
        embedding: c.embedding,
      })),
  };
}

function createKgPort(
  store: VectorStore,
  edgeStore: KgEdgeStore | undefined,
  kgOptions: KgOptions | undefined,
): KgExpanderPort | undefined {
  if (!kgOptions || !edgeStore) return undefined;
  return {
    enabled: kgOptions.enabled,
    edgeCount: edgeStore.count,
    expandFromSeeds: (seedNotes, queryEmbedding) =>
      expandFromSeeds(store, seedNotes, queryEmbedding, kgOptions, edgeStore),
  };
}

function createWebSearchPort(apiKey?: string): WebSearchPort | undefined {
  if (!apiKey) return undefined;
  return {
    search: async (query) => {
      const tavilyResponse = await searchTavily(apiKey, query);
      return formatWebContext(tavilyResponse.results, tavilyResponse.answer);
    },
  };
}

/** DEC-0022: Obsidian adapter — delegates portable turn with Notice notifications. */
export async function executeTurn(
  deps: TurnDeps,
  userInput: string,
  skipRag: boolean = false,
  pathFilter?: string[],
): Promise<TurnResult> {
  const selectionPaths = pathFilter !== undefined ? pathFilter : undefined;

  const portable: PortableTurnResult = await runPortableTurn({
    userInput,
    skipRag,
    selectionPaths,
    agent: deps.agent,
    projectContext: deps.projectContext,
    skillContext: deps.skillContext,
    conversationMessages: deps.conversationMessages,
    conversationSummary: deps.conversationSummary,
    traceId: deps.traceId,
    tavilyQuery: deps.tavilyQuery,
    notify: (message, durationMs) => new Notice(message, durationMs ?? 4000),
    ports: {
      chat: createChatPort(deps.opencodeClient),
      embedder: createEmbedderPort(deps.geminiBalancer),
      vectorStore: createVectorStorePort(
        deps.vectorStore,
        deps.projectContext,
        deps.sealedGeneration,
      ),
      tracer: deps.traceId ? createTracerPort(deps.tracer) : undefined,
      kg: createKgPort(deps.vectorStore, deps.edgeStore, deps.kgOptions),
      webSearch: hasWebSearch(deps) ? createWebSearchPort(deps.tavilyApiKey) : undefined,
    },
  });

  return {
    content: portable.content,
    usage: portable.usage,
    ragContext: portable.ragContext,
    conversationSummary: portable.conversationSummary,
    projectId: portable.projectId,
    provenance: portable.provenance,
  };
}

function hasWebSearch(deps: TurnDeps): boolean {
  return (
    deps.agent.tools?.includes("web_search") ||
    deps.skillContext?.tools?.includes("web_search") ||
    false
  );
}
