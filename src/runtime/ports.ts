/**
 * DEC-0022: structural runtime ports (no Obsidian/DOM/fs/network in portable core).
 * Per-call model/provider/AbortSignal options are forward-compatible; physical abort is wired in T-045.
 */

import type { EffectiveReadScope } from "./permissions";

export interface CallOptions {
  model?: string;
  provider?: string;
  signal?: AbortSignal;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
}

export interface ChatMessagePort {
  role: "system" | "user" | "assistant" | string;
  content: string;
}

/** DEC-0022: chat port with overload-compatible call shapes. */
export interface ChatPort {
  chat(
    systemPrompt: string,
    userPrompt: string,
    injectedContext?: string,
    options?: CallOptions,
  ): Promise<{ content: string; usage: TokenUsage }>;
  chatMessages(
    messages: ChatMessagePort[],
    options?: CallOptions,
  ): Promise<{ content: string; usage: TokenUsage }>;
}

/** DEC-0022: embedding port; sealed generation model is passed per call when available. */
export interface EmbedderPort {
  readonly hasKeys: boolean;
  embed(text: string, options?: CallOptions): Promise<number[]>;
}

export interface TraceChunkPort {
  source: "rag" | "kg";
  chunk: string;
  similarity_score: number;
  from_note: string;
  relation?: string;
}

export interface TracerPort {
  addChunk(traceId: string, chunk: TraceChunkPort): void;
}

export interface VectorChunkPort {
  id: string;
  notePath: string;
  chunkText: string;
  embedding: number[];
}

/** DEC-0022: sealed generation fingerprint for vector compatibility checks. */
export interface VectorIdentity {
  embedModel: string;
  dims: number;
  /** DEC-0022: sealed generation project; must match active project before embed. */
  projectId?: string;
  generationId?: string;
  provenance?: string;
}

/** DEC-0022: forward sealed model without arity introspection (default params have length 1). */
export function bindEmbedderPort(
  hasKeys: boolean,
  embedFn: (text: string, model?: string) => Promise<number[]>,
): EmbedderPort {
  return {
    hasKeys,
    embed: (text, options) => {
      const model = options?.model;
      if (model !== undefined) {
        return embedFn(text, model);
      }
      return embedFn(text);
    },
  };
}

export interface VectorStorePort {
  readonly count: number;
  readonly identity?: VectorIdentity;
  allChunks(): VectorChunkPort[];
}

export interface KgExpansionChunkPort {
  note_path: string;
  chunk_text: string;
  score: number;
  relation?: string;
}

export interface KgExpanderPort {
  readonly enabled: boolean;
  readonly edgeCount: number;
  expandFromSeeds(
    seedNotes: string[],
    queryEmbedding: number[],
    scope: EffectiveReadScope,
  ): { added_chunks: KgExpansionChunkPort[] };
}

export interface WebSearchPort {
  search(query: string, options?: CallOptions): Promise<string>;
}
