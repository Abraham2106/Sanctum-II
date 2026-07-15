import { cosineSimilarity } from "../rag/vector-store";
import type { Chunk } from "../rag/vector-store";
import type { VectorStore } from "../rag/vector-store";
import type { KgEdge, KgExpansionResult, KgOptions } from "./types";
import type { NativeLinkProvider } from "./native-links";
import { getExplicitEdges } from "./native-links";
import { KgEdgeStore } from "./kg-store";

export function noteCentroid(notePath: string, chunks: Chunk[]): number[] | null {
  const noteChunks = chunks.filter(c => c.note_path === notePath);
  if (noteChunks.length === 0) return null;
  const dims = noteChunks[0].embedding.length;
  const centroid = new Array(dims).fill(0);
  for (const c of noteChunks) {
    for (let i = 0; i < dims; i++) {
      centroid[i] += c.embedding[i];
    }
  }
  for (let i = 0; i < dims; i++) {
    centroid[i] /= noteChunks.length;
  }
  return centroid;
}

function buildAllCentroids(store: VectorStore): Map<string, number[]> {
  const centroids = new Map<string, number[]>();
  const notePaths = [...new Set(store.allChunks.map(c => c.note_path))];
  for (const notePath of notePaths) {
    const c = noteCentroid(notePath, store.allChunks);
    if (c) centroids.set(notePath, c);
  }
  return centroids;
}

export function computeSemanticEdges(
  centroids: Map<string, number[]>,
  threshold: number
): KgEdge[] {
  const edges: KgEdge[] = [];
  const paths = [...centroids.keys()];
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const a = centroids.get(paths[i])!;
      const b = centroids.get(paths[j])!;
      const sim = cosineSimilarity(a, b);
      if (sim >= threshold) {
        edges.push({
          from: paths[i],
          to: paths[j],
          type: "semantic",
          weight: sim,
          relation: "semantic",
        });
      }
    }
  }
  return edges;
}

function pickTopChunks(
  notePath: string,
  queryEmbedding: number[],
  chunks: Chunk[],
  maxCount: number
): { chunk_text: string; score: number }[] {
  const noteChunks = chunks.filter(c => c.note_path === notePath);
  const scored = noteChunks.map(c => ({
    chunk_text: c.chunk_text,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount);
}

function mergeEdges(semantic: KgEdge[], explicit: KgEdge[], reinforceBoost: boolean): KgEdge[] {
  const pairMap = new Map<string, KgEdge>();

  for (const e of semantic) {
    const key = [e.from, e.to].sort().join("::");
    pairMap.set(key, e);
  }

  for (const e of explicit) {
    const key = [e.from, e.to].sort().join("::");
    const existing = pairMap.get(key);
    if (existing && reinforceBoost) {
      existing.type = "reinforced";
      existing.weight = 1.0;
      existing.relation = "wikilink+semantic";
    } else if (!existing) {
      pairMap.set(key, { ...e });
    }
  }

  return [...pairMap.values()];
}

// ── Full recompute (O(n²), called once at startup) ──

export function recomputeAllEdges(
  store: VectorStore,
  edgeStore: KgEdgeStore,
  nativeLinks: NativeLinkProvider | undefined,
  opts: KgOptions,
): void {
  const centroids = buildAllCentroids(store);
  const semanticEdges = computeSemanticEdges(centroids, opts.minSimilarity);
  const explicitEdges = (nativeLinks && opts.useExplicit) ? getExplicitEdges(nativeLinks) : [];
  const allEdges = mergeEdges(semanticEdges, explicitEdges, opts.reinforceBoost);

  edgeStore.clear();
  for (const edge of allEdges) {
    edgeStore.addEdge(edge);
  }
}

// ── Incremental recompute for a single note (O(n), called on vault modify) ──

export function recomputeNoteEdges(
  notePath: string,
  store: VectorStore,
  edgeStore: KgEdgeStore,
  nativeLinks: NativeLinkProvider | undefined,
  opts: KgOptions,
): void {
  const centroid = noteCentroid(notePath, store.allChunks);
  if (!centroid) {
    edgeStore.delAllEdgesForNote(notePath);
    return;
  }

  edgeStore.delAllEdgesForNote(notePath);

  const allNotePaths = [...new Set(store.allChunks.map(c => c.note_path))];
  for (const otherPath of allNotePaths) {
    if (otherPath === notePath) continue;
    const otherCentroid = noteCentroid(otherPath, store.allChunks);
    if (!otherCentroid) continue;

    const sim = cosineSimilarity(centroid, otherCentroid);
    if (sim >= opts.minSimilarity) {
      edgeStore.addEdge({
        from: notePath,
        to: otherPath,
        type: "semantic",
        weight: sim,
        relation: "semantic",
      });
    }
  }

  // Merge explicit edges
  if (nativeLinks && opts.useExplicit) {
    const allExplicit = getExplicitEdges(nativeLinks);
    const relevant = allExplicit.filter(e => e.from === notePath || e.to === notePath);
    for (const e of relevant) {
      const existing = edgeStore.getEdge(e.from, e.to);
      if (existing && opts.reinforceBoost) {
        existing.type = "reinforced";
        existing.weight = 1.0;
        existing.relation = "wikilink+semantic";
      } else if (!existing) {
        edgeStore.addEdge(e);
      }
    }
  }
}

// ── Query-time expansion (O(1) edges, reads from store) ──

export function expandFromSeeds(
  store: VectorStore,
  seedNotes: string[],
  queryEmbedding: number[],
  opts: KgOptions,
  edgeStore: KgEdgeStore,
): KgExpansionResult {
  const allEdges = edgeStore.getAllEdges();

  const visited = new Set<string>(seedNotes);
  const neighborNotes: string[] = [];
  const edgesTraversed: KgEdge[] = [];

  let frontier = [...seedNotes];
  for (let hop = 0; hop < opts.hops && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];
    for (const note of frontier) {
      const outgoing = allEdges.filter(e => e.from === note || e.to === note);
      outgoing.sort((a, b) => b.weight - a.weight);
      for (const edge of outgoing.slice(0, opts.maxNeighborsPerHop)) {
        const neighbor = edge.from === note ? edge.to : edge.from;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          neighborNotes.push(neighbor);
          edgesTraversed.push(edge);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
  }

  const addedChunks: { note_path: string; chunk_text: string; score: number; relation: "wikilink" | "semantic" | "wikilink+semantic" }[] = [];
  const noteToRelation = new Map<string, "wikilink" | "semantic" | "wikilink+semantic">();
  for (const edge of edgesTraversed) {
    const neighbor = seedNotes.includes(edge.from) ? edge.to : edge.from;
    if (!noteToRelation.has(neighbor)) {
      noteToRelation.set(neighbor, edge.relation);
    }
  }
  for (const notePath of neighborNotes) {
    const top = pickTopChunks(notePath, queryEmbedding, store.allChunks, 2);
    for (const c of top) {
      addedChunks.push({ note_path: notePath, ...c, relation: noteToRelation.get(notePath) || "semantic" });
    }
  }

  return {
    edges_traversed: edgesTraversed,
    added_chunks: addedChunks,
    seed_notes: seedNotes,
    neighbor_notes: neighborNotes,
  };
}
