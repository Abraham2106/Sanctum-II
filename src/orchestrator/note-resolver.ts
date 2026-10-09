import type { CreatedNote } from "../projects/types";
import type { VectorStore } from "../rag/vector-store";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import { RAG_DEFAULTS } from "../constants";
import {
  buildEffectiveReadScope,
  filterAuthorizedPaths,
  isPathAuthorized,
  type EffectiveReadScope,
} from "../runtime/permissions"; // DEC-0022
import type { VectorIdentity } from "../runtime/ports";
import {
  evaluatePreEmbedStoreIdentity,
  retrieveContextChunks,
  resolveSealedEmbedIdentity,
} from "../runtime/retrieval";

export interface NoteResolution {
  path: string | null;
  method: "exact" | "rag_semantic" | "not_found" | "ambiguous";
  candidates?: { path: string; score: number; title: string }[];
}

/** Optional scope layers; omit to keep legacy resolver behavior for callers not yet wired. */
export interface NoteReferenceScopeInput {
  projectReadPaths?: string[] | null;
  agentReadPaths?: string[];
  selectionPaths?: string[];
  projectId?: string;
  projectRag?: { embed_model: string; dims: number; top_k?: number; min_similarity?: number };
}

const AMBIGUITY_THRESHOLD = 0.05;

function noteTitleMatchesQuery(title: string, query: string): boolean {
  const t = title.toLowerCase().trim();
  const q = query.toLowerCase().trim();
  if (!t || !q) return false;
  if (t.includes(q)) return true;
  // DEC-0016: un título de menos de 3 letras no coincide dentro de la frase
  if (t.length < 3) return false;
  let searchStart = 0;
  while (searchStart <= q.length - t.length) {
    const idx = q.indexOf(t, searchStart);
    if (idx === -1) break;
    const beforeOk = idx === 0 || !/[a-z0-9]/.test(q[idx - 1]);
    const afterOk = idx + t.length === q.length || !/[a-z0-9]/.test(q[idx + t.length]);
    if (beforeOk && afterOk) return true;
    searchStart = idx + 1;
  }
  return false;
}

function scopedCreatedNotes(
  createdNotes: CreatedNote[] | undefined,
  scope: EffectiveReadScope | null,
): CreatedNote[] | undefined {
  if (!createdNotes?.length) return createdNotes;
  if (!scope) return createdNotes;
  if (!scope.allowed) return [];
  return createdNotes.filter((note) => isPathAuthorized(note.path, scope));
}

function createVectorStorePort(store: VectorStore, sealed?: VectorIdentity) {
  return {
    count: store.count,
    identity: sealed,
    allChunks: () =>
      store.allChunks.map((c) => ({
        id: c.id,
        notePath: c.note_path,
        chunkText: c.chunk_text,
        embedding: c.embedding,
      })),
  };
}

async function resolveWithScopedRag(
  query: string,
  createdNotes: CreatedNote[] | undefined,
  vectorStore: VectorStore,
  geminiBalancer: GeminiBalancer,
  scope: EffectiveReadScope,
  scopeInput: NoteReferenceScopeInput,
  sealedGeneration: VectorIdentity,
): Promise<NoteResolution> {
  const projectRag = scopeInput.projectRag;
  const projectId = scopeInput.projectId?.trim();
  if (!projectRag || !projectId) {
    return { path: null, method: "not_found" };
  }

  const preEmbedDeny = evaluatePreEmbedStoreIdentity(projectRag, sealedGeneration, projectId);
  if (preEmbedDeny) {
    return { path: null, method: "not_found" };
  }

  const queryIdentity = resolveSealedEmbedIdentity(projectRag, projectId, {
    generationId: sealedGeneration.generationId,
    provenance: sealedGeneration.provenance,
    configFingerprint: sealedGeneration.configFingerprint,
  });
  if (!queryIdentity) {
    return { path: null, method: "not_found" };
  }

  try {
    const queryEmbedding = await geminiBalancer.embed(
      query,
      queryIdentity.embedModel,
      queryIdentity.dims,
    );
    const storePort = createVectorStorePort(vectorStore, sealedGeneration);
    const topK = projectRag.top_k ?? 10;
    const minSimilarity = projectRag.min_similarity ?? RAG_DEFAULTS.MIN_SIMILARITY;
    const { chunks } = retrieveContextChunks({
      queryEmbedding,
      queryIdentity,
      store: storePort,
      scope,
      topK,
      minSimilarity,
    });

    const allowedCreated =
      createdNotes && createdNotes.length > 0
        ? new Set(filterAuthorizedPaths(createdNotes.map((n) => n.path), scope))
        : null;

    const seen = new Map<string, number>();
    for (const chunk of chunks) {
      if (allowedCreated && !allowedCreated.has(chunk.notePath)) continue;
      const existing = seen.get(chunk.notePath);
      if (existing === undefined || chunk.score > existing) {
        seen.set(chunk.notePath, chunk.score);
      }
    }

    const candidates = Array.from(seen.entries())
      .map(([path, score]) => ({
        path,
        score,
        title: path.split("/").pop()?.replace(".md", "") || path,
      }))
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { path: null, method: "not_found" };
    }

    if (candidates.length >= 2 && candidates[0].score - candidates[1].score < AMBIGUITY_THRESHOLD) {
      return { path: null, method: "ambiguous", candidates: candidates.slice(0, 3) };
    }

    return { path: candidates[0].path, method: "rag_semantic", candidates };
  } catch (err: any) {
    console.warn("[NoteResolver] RAG search failed:", err.message);
    return { path: null, method: "not_found" };
  }
}

async function resolveLegacyRag(
  query: string,
  createdNotes: CreatedNote[] | undefined,
  vectorStore: VectorStore,
  geminiBalancer: GeminiBalancer,
): Promise<NoteResolution> {
  try {
    const queryEmbedding = await geminiBalancer.embed(query);
    let results = vectorStore.search(queryEmbedding, 10);

    if (createdNotes && createdNotes.length > 0) {
      const notePaths = new Set(createdNotes.map((n) => n.path));
      results = results.filter((r) => notePaths.has(r.chunk.note_path));
    }

    const seen = new Map<string, number>();
    for (const r of results) {
      const existing = seen.get(r.chunk.note_path);
      if (existing === undefined || r.score > existing) {
        seen.set(r.chunk.note_path, r.score);
      }
    }

    const candidates = Array.from(seen.entries())
      .map(([path, score]) => ({
        path,
        score,
        title: path.split("/").pop()?.replace(".md", "") || path,
      }))
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { path: null, method: "not_found" };
    }

    if (candidates.length >= 2 && candidates[0].score - candidates[1].score < AMBIGUITY_THRESHOLD) {
      return { path: null, method: "ambiguous", candidates: candidates.slice(0, 3) };
    }

    return { path: candidates[0].path, method: "rag_semantic", candidates };
  } catch (err: any) {
    console.warn("[NoteResolver] RAG search failed:", err.message);
    return { path: null, method: "not_found" };
  }
}

export async function resolveNoteReference(
  query: string,
  createdNotes: CreatedNote[] | undefined,
  vectorStore: VectorStore | undefined,
  geminiBalancer: GeminiBalancer | undefined,
  scopeInput?: NoteReferenceScopeInput,
  sealedGeneration?: VectorIdentity,
): Promise<NoteResolution> {
  const readScope = scopeInput
    ? buildEffectiveReadScope({
        projectReadPaths: scopeInput.projectReadPaths,
        agentReadPaths: scopeInput.agentReadPaths,
        selectionPaths: scopeInput.selectionPaths,
      })
    : null;

  if (readScope && !readScope.allowed) {
    return { path: null, method: "not_found" };
  }

  const notesForExact = scopedCreatedNotes(createdNotes, readScope);

  if (notesForExact && notesForExact.length > 0) {
    const matches = notesForExact.filter((n) => noteTitleMatchesQuery(n.title, query));
    if (matches.length === 1) {
      return {
        path: matches[0].path,
        method: "exact",
        candidates: [{ path: matches[0].path, score: 1.0, title: matches[0].title }],
      };
    }
    if (matches.length > 1) {
      return {
        path: null,
        method: "ambiguous",
        candidates: matches.map((m) => ({ path: m.path, score: 1.0, title: m.title })),
      };
    }
  }

  if (!vectorStore || !geminiBalancer || !geminiBalancer.hasKeys || vectorStore.count === 0) {
    return { path: null, method: "not_found" };
  }

  if (readScope && sealedGeneration) {
    return resolveWithScopedRag(
      query,
      createdNotes,
      vectorStore,
      geminiBalancer,
      readScope,
      scopeInput!,
      sealedGeneration,
    );
  }

  return resolveLegacyRag(query, createdNotes, vectorStore, geminiBalancer);
}
