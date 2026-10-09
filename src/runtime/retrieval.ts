import { cosineSimilarity } from "../rag/vector-store";
import type { EffectiveReadScope } from "./permissions";
import { isPathAuthorized, normalizeVaultPath } from "./permissions";
import type {
  KgExpanderPort,
  TracerPort,
  VectorChunkPort,
  VectorIdentity,
  VectorStorePort,
} from "./ports";

/** DEC-0022: ranked chunk candidate after authorization, scoring, and threshold. */
export interface RetrievedChunk {
  id: string;
  notePath: string;
  chunkText: string;
  score: number;
  source: "rag" | "kg";
  relation?: string;
}

export interface RetrievalParams {
  queryEmbedding: number[];
  queryIdentity: VectorIdentity;
  store: VectorStorePort;
  scope: EffectiveReadScope;
  topK: number;
  minSimilarity: number;
  kg?: KgExpanderPort;
  traceId?: string;
  tracer?: TracerPort;
}

export type RetrievalSkipReason =
  | "scope_denied"
  | "identity_mismatch"
  | "empty_store"
  | "embedding_dims_mismatch";

/** DEC-0022: exact model/dims/provenance compatibility; no silent fallback. */
export function vectorIdentitiesCompatible(
  query: VectorIdentity,
  store: VectorIdentity,
): boolean {
  if (!query.embedModel || !store.embedModel) return false;
  if (query.dims !== store.dims) return false;
  if (query.embedModel !== store.embedModel) return false;
  if (query.generationId && store.generationId && query.generationId !== store.generationId) {
    return false;
  }
  if (query.provenance && store.provenance && query.provenance !== store.provenance) {
    return false;
  }
  return true;
}

function scoreAuthorizedChunks(
  chunks: VectorChunkPort[],
  queryEmbedding: number[],
  scope: EffectiveReadScope,
  minSimilarity: number,
): RetrievedChunk[] {
  if (queryEmbedding.length === 0) return [];
  const scored: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const normPath = normalizeVaultPath(chunk.notePath);
    if (!normPath || !isPathAuthorized(normPath, scope)) continue;
    if (chunk.embedding.length !== queryEmbedding.length) continue;
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (score < minSimilarity) continue;
    scored.push({
      id: chunk.id,
      notePath: normPath,
      chunkText: chunk.chunkText,
      score,
      source: "rag",
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function pushTrace(tracer: TracerPort | undefined, traceId: string | undefined, chunk: RetrievedChunk): void {
  if (!tracer || !traceId) return;
  tracer.addChunk(traceId, {
    source: chunk.source,
    chunk: chunk.chunkText,
    similarity_score: chunk.score,
    from_note: chunk.notePath,
    relation: chunk.relation,
  });
}

/**
 * DEC-0022: filter candidates before top-k; enforce min similarity without fallback;
 * KG expansion only through authorized seeds and neighbors.
 */
export function retrieveContextChunks(params: RetrievalParams): {
  chunks: RetrievedChunk[];
  skipReason?: RetrievalSkipReason;
} {
  const {
    queryEmbedding,
    queryIdentity,
    store,
    scope,
    topK,
    minSimilarity,
    kg,
    traceId,
    tracer,
  } = params;

  if (!scope.allowed) {
    return { chunks: [], skipReason: "scope_denied" };
  }
  if (store.count === 0) {
    return { chunks: [], skipReason: "empty_store" };
  }
  if (queryEmbedding.length === 0) {
    return { chunks: [], skipReason: "embedding_dims_mismatch" };
  }

  const storeIdentity = store.identity;
  if (storeIdentity && !vectorIdentitiesCompatible(queryIdentity, storeIdentity)) {
    return { chunks: [], skipReason: "identity_mismatch" };
  }

  let results = scoreAuthorizedChunks(store.allChunks(), queryEmbedding, scope, minSimilarity);
  results = results.slice(0, topK);

  const seedNotes = [...new Set(results.map((r) => r.notePath))];

  if (kg?.enabled && kg.edgeCount > 0 && seedNotes.length > 0) {
    const expansion = kg.expandFromSeeds(seedNotes, queryEmbedding);
    const merged = [...results];
    const seen = new Set(results.map((r) => `${r.notePath}\0${r.chunkText}`));

    for (const ac of expansion.added_chunks) {
      const normPath = normalizeVaultPath(ac.note_path);
      if (!normPath || !isPathAuthorized(normPath, scope)) continue;
      const key = `${normPath}\0${ac.chunk_text}`;
      if (seen.has(key)) continue;
      if (ac.score < minSimilarity) continue;
      seen.add(key);
      merged.push({
        id: "",
        notePath: normPath,
        chunkText: ac.chunk_text,
        score: ac.score,
        source: "kg",
        relation: ac.relation,
      });
    }

    merged.sort((a, b) => b.score - a.score);
    results = merged.slice(0, topK);
  }

  for (const chunk of results) {
    pushTrace(tracer, traceId, chunk);
  }

  return { chunks: results };
}

/** DEC-0022: format authorized chunks for prompt injection. */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  return chunks.map((r) => `[${r.notePath}]\n${r.chunkText}`).join("\n\n");
}

/** DEC-0022: resolve sealed embed model from project RAG config. */
export function resolveSealedEmbedIdentity(
  projectRag: { embed_model: string; dims: number } | undefined,
  overrides?: Partial<VectorIdentity>,
): VectorIdentity | null {
  if (!projectRag?.embed_model?.trim()) return null;
  return {
    embedModel: projectRag.embed_model.trim(),
    dims: projectRag.dims,
    generationId: overrides?.generationId,
    provenance: overrides?.provenance,
  };
}
