import { cosineSimilarity } from "../rag/vector-store";
import { noteCentroid, computeSemanticEdges, expandFromSeeds, recomputeAllEdges, recomputeNoteEdges } from "./kg";
import type { Chunk } from "../rag/vector-store";
import type { VectorStore } from "../rag/vector-store";
import { KgEdgeStore } from "./kg-store";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

// --- Mock chunks ---

// --- Mock chunks ---
const dims = 4;
function makeChunk(notePath: string, id: string, vec: number[]): Chunk {
  return { id, note_path: notePath, chunk_text: `content of ${id}`, embedding: vec };
}

const noteA_chunks = [
  makeChunk("note-a.md", "a1", [1, 0, 0, 0]),
  makeChunk("note-a.md", "a2", [0.9, 0.1, 0, 0]),
];
const noteB_chunks = [
  makeChunk("note-b.md", "b1", [0, 1, 0, 0]),
  makeChunk("note-b.md", "b2", [0.1, 0.9, 0, 0]),
];
const noteC_chunks = [
  makeChunk("note-c.md", "c1", [0, 0, 1, 0]),
];
const noteD_chunks = [
  makeChunk("note-d.md", "d1", [0, 0, 0, 1]),
];
const allChunks = [...noteA_chunks, ...noteB_chunks, ...noteC_chunks, ...noteD_chunks];

// --- Mock VectorStore ---
const mockStore: VectorStore = {
  get allChunks(): Chunk[] { return allChunks; },
  get count(): number { return allChunks.length; },
  search: () => [],
  filterByPaths: (r: any, _: string[]) => r,
} as any;

// ============================================================
// Test: cosineSimilarity
// ============================================================
console.log("\n--- cosineSimilarity ---");
assert(cosineSimilarity([1, 0], [1, 0]) === 1, "identical vectors → 1");
assert(Math.abs(cosineSimilarity([1, 0], [-1, 0]) - (-1)) < 1e-6, "opposite vectors → -1");
assert(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-6, "orthogonal vectors → 0");
assert(Math.abs(cosineSimilarity([2, 0], [1, 0]) - 1) < 1e-6, "collinear vectors → 1");

// ============================================================
// Test: noteCentroid
// ============================================================
console.log("\n--- noteCentroid ---");
const centroidA = noteCentroid("note-a.md", allChunks);
assert(centroidA !== null, "centroidA is not null");
assert(centroidA![0] === 0.95, `centroidA[0] = ${centroidA![0]} (expected 0.95)`);
assert(centroidA![1] === 0.05, `centroidA[1] = ${centroidA![1]} (expected 0.05)`);

const centroidC = noteCentroid("note-c.md", allChunks);
assert(centroidC![2] === 1, "centroidC[2] = 1");

const centroidNone = noteCentroid("nonexistent.md", allChunks);
assert(centroidNone === null, "nonexistent note → null");

// ============================================================
// Test: computeSemanticEdges
// ============================================================
console.log("\n--- computeSemanticEdges ---");
const centroids = new Map<string, number[]>();
centroids.set("note-a.md", centroidA!);
centroids.set("note-b.md", noteCentroid("note-b.md", allChunks)!);
centroids.set("note-c.md", centroidC!);
centroids.set("note-d.md", noteCentroid("note-d.md", allChunks)!);

// With threshold 0.5, A and B should connect (sim ≈ 0.14), C and D orthogonal to everyone
const edges05 = computeSemanticEdges(centroids, 0.5);
assert(edges05.length === 0, "threshold 0.5 → no edges (A×B ≈ 0.14)");

// A and B: vecs [0.95, 0.05, 0, 0] vs [0.05, 0.95, 0, 0]: dot = 0.0475+0.0475=0.095, norms=0.9513 → sim ≈ 0.099
// Let's check: A norm ≈ sqrt(0.9025+0.0025)=0.9513, B norm ≈ sqrt(0.0025+0.9025)=0.9513
// dot = 0.95*0.05 + 0.05*0.95 = 0.0475+0.0475 = 0.095
// sim = 0.095/0.905 = 0.105
// So no edges even at 0.1 threshold.

// Let's use a very low threshold to verify edges are created
const edges01 = computeSemanticEdges(centroids, 0.1);
assert(edges01.length === 1, `threshold 0.1 → 1 edge (got ${edges01.length})`);
assert(edges01[0].type === "semantic", "edge type is semantic");
assert(edges01[0].weight > 0, "edge weight > 0");

// ============================================================
// Test: expandFromSeeds
// ============================================================
console.log("\n--- expandFromSeeds ---");
const queryEmbedding = [1, 0.1, 0, 0];

const semanticStore = new KgEdgeStore();
semanticStore.addEdge({ from: "note-a.md", to: "note-b.md", type: "semantic", weight: 0.105, relation: "semantic" });
const result = expandFromSeeds(mockStore, ["note-a.md"], queryEmbedding, {
  enabled: true,
  minSimilarity: 0.1,
  hops: 1,
  maxNeighborsPerHop: 2,
  useExplicit: true,
  reinforceBoost: true,
}, semanticStore);

assert(result.seed_notes.length === 1, "1 seed note");
assert(result.seed_notes[0] === "note-a.md", "seed is note-a");
console.log(`  neighbor_notes: ${JSON.stringify(result.neighbor_notes)}`);
console.log(`  edges: ${JSON.stringify(result.edges_traversed.map(e => `${e.from}↔${e.to} (${e.weight.toFixed(3)})`))}`);
console.log(`  added_chunks: ${result.added_chunks.length}`);

// The note-a centroid is [0.95, 0.05, 0, 0]. note-b centroid is [0.05, 0.95, 0, 0].
// sim ≈ 0.105. At threshold 0.1, they should connect.
assert(result.neighbor_notes.includes("note-b.md"), "note-b is a neighbor of note-a");
assert(result.edges_traversed.length >= 1, "at least 1 edge traversed");
assert(result.added_chunks.length > 0, "at least 1 chunk added from neighbor");

// Test with high threshold → no expansion
const noExpand = expandFromSeeds(mockStore, ["note-a.md"], queryEmbedding, {
  enabled: true,
  minSimilarity: 0.9,
  hops: 1,
  maxNeighborsPerHop: 2,
  useExplicit: true,
  reinforceBoost: true,
}, new KgEdgeStore());
assert(noExpand.added_chunks.length === 0, "threshold 0.9 → no expansion");
assert(noExpand.edges_traversed.length === 0, "threshold 0.9 → no edges");

// ============================================================
// Helper: build a populated edge store
// ============================================================
function makeEdgeStore(edges: { from: string; to: string; type: "explicit" | "semantic" | "reinforced"; weight: number; relation: "wikilink" | "semantic" | "wikilink+semantic" }[]): KgEdgeStore {
  const store = new KgEdgeStore();
  for (const e of edges) store.addEdge(e);
  return store;
}

// ============================================================
// Test: expandFromSeeds with explicit edges
// ============================================================
console.log("\n--- expandFromSeeds with explicit edges ---");

const withExplicit = expandFromSeeds(mockStore, ["note-a.md"], queryEmbedding, {
  enabled: true,
  minSimilarity: 0.9,
  hops: 1,
  maxNeighborsPerHop: 3,
  useExplicit: true,
  reinforceBoost: true,
}, makeEdgeStore([
  { from: "note-a.md", to: "note-c.md", type: "explicit", weight: 1.0, relation: "wikilink" },
]));

assert(withExplicit.neighbor_notes.includes("note-c.md"), "explicit edge note-a→note-c is traversed");
const explicitEdge = withExplicit.edges_traversed.find(e => e.type === "explicit");
assert(!!explicitEdge, "at least one explicit edge was traversed");
assert(explicitEdge!.weight === 1.0, "explicit edge weight is 1.0");

// When a pair has both semantic + explicit → recomputeAllEdges produces reinforced
const mergedStore = new KgEdgeStore();
recomputeAllEdges(mockStore, mergedStore, {
  getResolvedLinks: () => ({ "note-a.md": { "note-b.md": 1 } }),
}, {
  enabled: true,
  minSimilarity: 0.1,
  hops: 1,
  maxNeighborsPerHop: 3,
  useExplicit: true,
  reinforceBoost: true,
});

const mergedEdge = mergedStore.getAllEdges().find(e => e.from.includes("note-b") || e.to.includes("note-b"));
assert(!!mergedEdge, "note-b edge exists after recomputeAllEdges");
assert(mergedEdge!.type === "reinforced", "recomputeAllEdges produces reinforced when explicit+semantic");
assert(mergedEdge!.weight === 1.0, "reinforced edge weight is 1.0");
assert(mergedEdge!.relation === "wikilink+semantic", "reinforced edge relation is wikilink+semantic");

// Test: added_chunks carry relation
assert(withExplicit.added_chunks.length > 0, "explicit expansion added chunks");
const chunkWithRelation = withExplicit.added_chunks.find(c => c.relation !== undefined);
assert(!!chunkWithRelation, "added chunks carry relation field");

// ============================================================
// Test: recomputeAllEdges (full O(n²) recompute)
// ============================================================
console.log("\n--- recomputeAllEdges ---");

const fullStore = new KgEdgeStore();
recomputeAllEdges(mockStore, fullStore, undefined, {
  enabled: true,
  minSimilarity: 0.1,
  hops: 1,
  maxNeighborsPerHop: 3,
  useExplicit: false,
  reinforceBoost: true,
});

assert(fullStore.count > 0, "recomputeAllEdges created edges");
const semanticOnly = fullStore.getAllEdges();
assert(semanticOnly.every(e => e.type === "semantic"), "all edges are semantic when useExplicit=false");
assert(semanticOnly.some(e => e.from.includes("note-a") && e.to.includes("note-b")), "note-a↔note-b edge found");

// With explicit edges
const fullStore2 = new KgEdgeStore();
recomputeAllEdges(mockStore, fullStore2, {
  getResolvedLinks: () => ({ "note-a.md": { "note-c.md": 1 } }),
}, {
  enabled: true,
  minSimilarity: 0.1,
  hops: 1,
  maxNeighborsPerHop: 3,
  useExplicit: true,
  reinforceBoost: true,
});

const explicitFound = fullStore2.getAllEdges().find(e => e.relation === "wikilink" || e.relation === "wikilink+semantic");
assert(!!explicitFound, "recomputeAllEdges includes explicit edges");

// ============================================================
// Test: recomputeNoteEdges (incremental O(n))
// ============================================================
console.log("\n--- recomputeNoteEdges ---");

const incrementalStore = new KgEdgeStore();
recomputeNoteEdges("note-b.md", mockStore, incrementalStore, undefined, {
  enabled: true,
  minSimilarity: 0.1,
  hops: 1,
  maxNeighborsPerHop: 3,
  useExplicit: false,
  reinforceBoost: true,
});

assert(incrementalStore.count > 0, "recomputeNoteEdges created edges for note-b");
const bEdges = incrementalStore.getEdgesForNote("note-b.md");
assert(bEdges.length > 0, "note-b has edges after incremental recompute");
assert(bEdges.some(e => e.to === "note-a.md" || e.from === "note-a.md"), "note-b↔note-a edge recomputed");

// Recompute again for same note — should replace, not duplicate
const prevCount = incrementalStore.count;
recomputeNoteEdges("note-b.md", mockStore, incrementalStore, undefined, {
  enabled: true,
  minSimilarity: 0.1,
  hops: 1,
  maxNeighborsPerHop: 3,
  useExplicit: false,
  reinforceBoost: true,
});
assert(incrementalStore.count === prevCount, "recomputeNoteEdges is idempotent (no duplicate edges)");

// ============================================================
// Test: layout functions
// ============================================================
console.log("\n--- layout ---");

import { forceLayout, convolutionalLayout, neighborsOf } from "./layout";

const testEdges = [
  { from: "a.md", to: "b.md", type: "explicit" as const, weight: 1.0, relation: "wikilink" as const },
  { from: "b.md", to: "c.md", type: "semantic" as const, weight: 0.8, relation: "semantic" as const },
  { from: "c.md", to: "d.md", type: "explicit" as const, weight: 1.0, relation: "wikilink" as const },
];

const fLayout = forceLayout(testEdges, 500, 400, 5);
assert(fLayout.positions.size === 4, "forceLayout positions all 4 nodes");
assert(fLayout.adjacency.size >= 3, "forceLayout adjacency built");

const cLayout = convolutionalLayout("a.md", testEdges, 500, 400, 2);
assert(cLayout.positions.size === 4, "convolutionalLayout positions all 4 nodes");
assert(cLayout.layers!.get("a.md") === 0, "seed is layer 0");
assert(cLayout.layers!.get("b.md") === 1, "b is layer 1");
assert(cLayout.layers!.get("c.md") === 2, "c is layer 2 (2 hops)");
assert(cLayout.layers!.get("d.md") !== undefined, "d assigned a layer");

const nb = neighborsOf("a.md", cLayout.adjacency);
assert(nb.has("a.md"), "neighborsOf includes self");
assert(nb.has("b.md"), "neighborsOf includes direct neighbor");

// ============================================================
console.log("\n✅ All KG tests passed!");
