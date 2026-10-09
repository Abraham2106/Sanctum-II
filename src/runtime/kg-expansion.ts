import { cosineSimilarity } from "./cosine";
import type { EffectiveReadScope } from "./permissions";
import { isPathAuthorized, normalizeVaultPath } from "./permissions";
import type { KgExpansionChunkPort, VectorChunkPort } from "./ports";

export interface KgEdgeLike {
  from: string;
  to: string;
  weight: number;
  relation?: string;
}

export interface AuthorizedKgExpandParams {
  seedNotes: string[];
  queryEmbedding: number[];
  scope: EffectiveReadScope;
  hops: number;
  maxNeighborsPerHop: number;
  edges: KgEdgeLike[];
  chunks: VectorChunkPort[];
}

function authorizedNotePath(notePath: string, scope: EffectiveReadScope): string | null {
  const norm = normalizeVaultPath(notePath);
  if (!norm || !isPathAuthorized(norm, scope)) return null;
  return norm;
}

function pickTopChunksForNote(
  notePath: string,
  queryEmbedding: number[],
  chunks: VectorChunkPort[],
  maxCount: number,
): { chunk_text: string; score: number }[] {
  const noteChunks = chunks.filter((c) => normalizeVaultPath(c.notePath) === notePath);
  const scored = noteChunks.map((c) => ({
    chunk_text: c.chunkText,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount);
}

/**
 * DEC-0022: KG BFS only through authorized nodes — denied intermediates cannot bridge paths.
 */
export function authorizedExpandFromSeeds(params: AuthorizedKgExpandParams): {
  added_chunks: KgExpansionChunkPort[];
} {
  const {
    seedNotes,
    queryEmbedding,
    scope,
    hops,
    maxNeighborsPerHop,
    edges,
    chunks,
  } = params;

  const authorizedSeeds: string[] = [];
  const visited = new Set<string>();
  for (const seed of seedNotes) {
    const norm = authorizedNotePath(seed, scope);
    if (!norm || visited.has(norm)) continue;
    visited.add(norm);
    authorizedSeeds.push(norm);
  }

  const neighborNotes: string[] = [];
  const noteToRelation = new Map<string, string>();
  let frontier = [...authorizedSeeds];

  for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];
    for (const note of frontier) {
      const outgoing = edges.filter((e) => {
        const from = normalizeVaultPath(e.from);
        const to = normalizeVaultPath(e.to);
        return from === note || to === note;
      });
      outgoing.sort((a, b) => b.weight - a.weight);
      for (const edge of outgoing.slice(0, maxNeighborsPerHop)) {
        const from = normalizeVaultPath(edge.from);
        const to = normalizeVaultPath(edge.to);
        const rawNeighbor = from === note ? edge.to : edge.from;
        const neighbor = authorizedNotePath(rawNeighbor, scope);
        if (!neighbor || visited.has(neighbor)) continue;
        visited.add(neighbor);
        neighborNotes.push(neighbor);
        if (!noteToRelation.has(neighbor)) {
          noteToRelation.set(neighbor, edge.relation ?? "semantic");
        }
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  const added_chunks: KgExpansionChunkPort[] = [];
  for (const notePath of neighborNotes) {
    const top = pickTopChunksForNote(notePath, queryEmbedding, chunks, 2);
    for (const c of top) {
      added_chunks.push({
        note_path: notePath,
        chunk_text: c.chunk_text,
        score: c.score,
        relation: noteToRelation.get(notePath) ?? "semantic",
      });
    }
  }

  return { added_chunks };
}
