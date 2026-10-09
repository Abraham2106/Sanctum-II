import { Notice } from "obsidian";
import type { AgentDefinition } from "../agents/types";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer, TraceChunk } from "../observability/tracer";
import { searchTavily, formatWebContext } from "../tools/tavily";
import type { KgOptions } from "../kg/types";
import type { KgEdgeStore } from "../kg/kg-store";
import type { ProjectContext } from "../projects/context";
import type { Skill } from "../skills/types";
import type { ConversationMessage } from "./conversation";
import type { ChatMessage } from "../llm/chat-wire";
import { authorizedExpandFromSeeds } from "../runtime/kg-expansion";
import type {
  ChatPort,
  EmbedderPort,
  KgExpanderPort,
  TracerPort,
  VectorIdentity,
  VectorStorePort,
  WebSearchPort,
} from "../runtime/ports";
import type { EffectiveReadScope } from "../runtime/permissions";
import { bindEmbedderPort } from "../runtime/ports";
import { runPortableTurn } from "../runtime/turn";
import type { PortableTurnResult } from "../runtime/turn";

export interface TurnDeps {
  agent: AgentDefinition;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  /** DEC-0023: optional injected embedding port (defaults to Gemini balancer). */
  embedder?: EmbedderPort;
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
  const chat = client.chat.bind(client) as ChatPort["chat"];
  const chatMessages = client.chat.bind(client) as ChatPort["chatMessages"];
  return { chat, chatMessages };
}

function createDefaultEmbedderPort(balancer: GeminiBalancer): EmbedderPort {
  return bindEmbedderPort(balancer.hasKeys, (text) => balancer.embed(text));
}

function createTracerPort(tracer: Tracer): TracerPort {
  return {
    addChunk: (traceId, chunk) => tracer.addChunk(traceId, chunk as TraceChunk),
  };
}

function createVectorStorePort(
  store: VectorStore,
  sealedGeneration?: VectorIdentity,
): VectorStorePort {
  return {
    count: store.count,
    identity: sealedGeneration,
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
  const chunks = () =>
    store.allChunks.map((c) => ({
      id: c.id,
      notePath: c.note_path,
      chunkText: c.chunk_text,
      embedding: c.embedding,
    }));
  return {
    enabled: kgOptions.enabled,
    edgeCount: edgeStore.count,
    expandFromSeeds: (seedNotes, queryEmbedding, scope: EffectiveReadScope) =>
      authorizedExpandFromSeeds({
        seedNotes,
        queryEmbedding,
        scope,
        hops: kgOptions.hops,
        maxNeighborsPerHop: kgOptions.maxNeighborsPerHop,
        edges: edgeStore.getAllEdges().map((e) => ({
          from: e.from,
          to: e.to,
          weight: e.weight,
          relation: e.relation,
        })),
        chunks: chunks(),
      }),
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
    expectedVectorSeal: deps.sealedGeneration
      ? {
          generationId: deps.sealedGeneration.generationId,
          provenance: deps.sealedGeneration.provenance,
        }
      : undefined,
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
      embedder: deps.embedder ?? createDefaultEmbedderPort(deps.geminiBalancer),
      vectorStore: createVectorStorePort(deps.vectorStore, deps.sealedGeneration),
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
