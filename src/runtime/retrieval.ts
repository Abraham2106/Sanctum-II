import { cosineSimilarity } from "./cosine";
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
  | "embedding_dims_mismatch"
  | "rebuild_required"
  | "invalid_threshold"
  | "invalid_top_k";

/** DEC-0022: positive integer embedding dimensions only. */
export function isValidVectorDims(dims: unknown): dims is number {
  return typeof dims === "number" && Number.isInteger(dims) && dims > 0;
}

/** DEC-0022: trusted index identity from sealed generation metadata (not project settings). */
export function isVerifiableStoreIdentity(identity: VectorIdentity | undefined): boolean {
  if (!identity) return false;
  if (!identity.projectId?.trim()) return false;
  if (!identity.embedModel?.trim()) return false;
  if (!isValidVectorDims(identity.dims)) return false;
  return true;
}

export function embeddingMatchesDims(embedding: number[], dims: number): boolean {
  return embedding.length === dims && embedding.every((v) => Number.isFinite(v));
}

/** DEC-0022: exact model/dims/provenance compatibility; no silent fallback. */
export function vectorIdentitiesCompatible(
  query: VectorIdentity,
  store: VectorIdentity,
): boolean {
  if (!query.projectId?.trim() || !store.projectId?.trim()) return false;
  if (query.projectId.trim() !== store.projectId.trim()) return false;
  if (!query.embedModel?.trim() || !store.embedModel?.trim()) return false;
  if (!isValidVectorDims(query.dims) || !isValidVectorDims(store.dims)) return false;
  if (query.dims !== store.dims) return false;
  if (query.embedModel !== store.embedModel) return false;
  if (query.generationId) {
    if (!store.generationId || query.generationId !== store.generationId) return false;
  }
  if (query.provenance) {
    if (!store.provenance || query.provenance !== store.provenance) return false;
  }
  return true;
}

/** DEC-0022: fail-closed similarity threshold (no silent fallback to 1). */
export function parseMinSimilarityThreshold(minSimilarity: number): number | null {
  if (!Number.isFinite(minSimilarity)) return null;
  return minSimilarity;
}

/** DEC-0022: positive finite integer top-k only. */
export function parseTopKLimit(topK: number): number | null {
  if (!Number.isFinite(topK) || !Number.isInteger(topK) || topK <= 0) return null;
  return topK;
}

function scoreAuthorizedChunks(
  chunks: VectorChunkPort[],
  queryEmbedding: number[],
  queryDims: number,
  scope: EffectiveReadScope,
  minSimilarity: number,
): RetrievedChunk[] {
  if (!embeddingMatchesDims(queryEmbedding, queryDims)) return [];
  const threshold = parseMinSimilarityThreshold(minSimilarity);
  if (threshold === null) return [];
  const scored: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const normPath = normalizeVaultPath(chunk.notePath);
    if (!normPath || !isPathAuthorized(normPath, scope)) continue;
    if (!embeddingMatchesDims(chunk.embedding, queryDims)) continue;
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (!Number.isFinite(score) || score < threshold) continue;
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

  const storeIdentity = store.identity;
  if (!isVerifiableStoreIdentity(storeIdentity)) {
    return { chunks: [], skipReason: "rebuild_required" };
  }
  if (!vectorIdentitiesCompatible(queryIdentity, storeIdentity!)) {
    return { chunks: [], skipReason: "identity_mismatch" };
  }

  if (!isValidVectorDims(queryIdentity.dims)) {
    return { chunks: [], skipReason: "embedding_dims_mismatch" };
  }
  if (!embeddingMatchesDims(queryEmbedding, queryIdentity.dims)) {
    return { chunks: [], skipReason: "embedding_dims_mismatch" };
  }

  const parsedTopK = parseTopKLimit(topK);
  if (parsedTopK === null) {
    return { chunks: [], skipReason: "invalid_top_k" };
  }
  const parsedThreshold = parseMinSimilarityThreshold(minSimilarity);
  if (parsedThreshold === null) {
    return { chunks: [], skipReason: "invalid_threshold" };
  }

  if (store.count === 0) {
    return { chunks: [], skipReason: "empty_store" };
  }

  let results = scoreAuthorizedChunks(
    store.allChunks(),
    queryEmbedding,
    queryIdentity.dims,
    scope,
    parsedThreshold,
  );
  results = results.slice(0, parsedTopK);

  const seedNotes = [...new Set(results.map((r) => r.notePath))];

  if (kg?.enabled && kg.edgeCount > 0 && seedNotes.length > 0) {
    const expansion = kg.expandFromSeeds(seedNotes, queryEmbedding, scope);
    const merged = [...results];
    const seen = new Set(results.map((r) => `${r.notePath}\0${r.chunkText}`));
    for (const ac of expansion.added_chunks) {
      const normPath = normalizeVaultPath(ac.note_path);
      if (!normPath || !isPathAuthorized(normPath, scope)) continue;
      const key = `${normPath}\0${ac.chunk_text}`;
      if (seen.has(key)) continue;
      if (!Number.isFinite(ac.score) || ac.score < parsedThreshold) continue;
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
    results = merged.slice(0, parsedTopK);
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

export interface ExpectedVectorSeal {
  generationId?: string;
  provenance?: string;
}

/** DEC-0022: query identity from project RAG + active project; seal fields only when explicitly expected. */
export function resolveSealedEmbedIdentity(
  projectRag: { embed_model: string; dims: number } | undefined,
  activeProjectId: string | undefined,
  explicitExpected?: ExpectedVectorSeal,
): VectorIdentity | null {
  if (!projectRag?.embed_model?.trim()) return null;
  if (!isValidVectorDims(projectRag.dims)) return null;
  if (!activeProjectId?.trim()) return null;
  const base: VectorIdentity = {
    embedModel: projectRag.embed_model.trim(),
    dims: projectRag.dims,
    projectId: activeProjectId.trim(),
  };
  if (explicitExpected?.generationId) {
    base.generationId = explicitExpected.generationId;
  }
  if (explicitExpected?.provenance) {
    base.provenance = explicitExpected.provenance;
  }
  return base;
}

/** DEC-0022: gate embed on verifiable store project + model/dims before calling the provider. */
export function evaluatePreEmbedStoreIdentity(
  projectRag: { embed_model: string; dims: number },
  storeIdentity: VectorIdentity | undefined,
  activeProjectId: string,
): RetrievalSkipReason | null {
  if (!isVerifiableStoreIdentity(storeIdentity)) {
    return "rebuild_required";
  }
  const store = storeIdentity!;
  if (!store.projectId?.trim()) {
    return "rebuild_required";
  }
  if (store.projectId.trim() !== activeProjectId.trim()) {
    return "identity_mismatch";
  }
  if (
    store.embedModel !== projectRag.embed_model.trim() ||
    store.dims !== projectRag.dims
  ) {
    return "identity_mismatch";
  }
  return null;
}
