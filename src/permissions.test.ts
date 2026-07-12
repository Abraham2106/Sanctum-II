import { describe, it, expect, vi } from "vitest";
import { globMatch, pathMatchesAny, isInternalPath } from "./utils";
import { VectorStore, type Chunk } from "./rag/vector-store";

function makeChunk(notePath: string): { chunk: Chunk; score: number } {
  return {
    chunk: { id: notePath, note_path: notePath, chunk_text: `content of ${notePath}`, embedding: [1, 0, 0] },
    score: 0.85,
  };
}

// ============================================================
// Consolidated globMatch / pathMatchesAny
// ============================================================

describe("globMatch", () => {
  it("matches exact path", () => {
    expect(globMatch("Research/nota.md", "Research/**")).toBe(true);
  });

  it("matches with leading slash", () => {
    expect(globMatch("Research/nota.md", "/Research/**")).toBe(true);
  });

  it("rejects non-matching path", () => {
    expect(globMatch("Finanzas/reporte.md", "Research/**")).toBe(false);
  });

  it("** pattern matches everything", () => {
    expect(globMatch("any/deep/path.md", "**")).toBe(true);
  });

  it("single * matches within one segment", () => {
    expect(globMatch("Research/nota.md", "Research/*.md")).toBe(true);
  });

  it("empty pattern matches everything", () => {
    expect(globMatch("any.md", "")).toBe(true);
  });
});

describe("pathMatchesAny", () => {
  it("returns true when patterns is undefined", () => {
    expect(pathMatchesAny("Research/nota.md", undefined)).toBe(true);
  });

  it("returns true when patterns is empty array", () => {
    expect(pathMatchesAny("Research/nota.md", [])).toBe(true);
  });

  it("returns true for /** wildcard", () => {
    expect(pathMatchesAny("Secret/file.md", ["/**"])).toBe(true);
    expect(pathMatchesAny("Secret/file.md", ["**"])).toBe(true);
  });

  it("matches path against pattern list", () => {
    expect(pathMatchesAny("Research/nota.md", ["/Research/**"])).toBe(true);
  });

  it("rejects path matching no pattern", () => {
    expect(pathMatchesAny("Finanzas/reporte.md", ["/Research/**", "/Docs/**"])).toBe(false);
  });

  it("single pattern match in list", () => {
    expect(pathMatchesAny("Docs/readme.md", ["/Research/**", "/Docs/**"])).toBe(true);
  });
});

// ============================================================
// Brecha #3 — Intersección de permisos
// ============================================================

describe("Brecha #3 — Path intersection via sequential filterByPaths", () => {
  it("both filters match → all chunks pass", () => {
    const store = new VectorStore();
    const chunks = [
      makeChunk("Research/nota-a.md"),
      makeChunk("Research/nota-b.md"),
    ];
    const pathFilter = ["/Research/**"];
    const agentPerms = ["/Research/**"];

    let results = store.filterByPaths(chunks, pathFilter);
    results = store.filterByPaths(results, agentPerms);
    expect(results).toHaveLength(2);
  });

  it("disjoint filters → empty result (brecha #3)", () => {
    const store = new VectorStore();
    const chunks = [
      makeChunk("Finanzas/reporte.md"),
      makeChunk("Finanzas/balance.md"),
    ];
    const pathFilter = ["/Finanzas/**"];          // external asks for Finanzas
    const agentPerms = ["/Quantum/**"];            // agent only has Quantum

    let results = store.filterByPaths(chunks, pathFilter);
    results = store.filterByPaths(results, agentPerms);
    expect(results).toHaveLength(0);               // intersection is empty
  });

  it("no pathFilter → only agent permissions apply", () => {
    const store = new VectorStore();
    const chunks = [
      makeChunk("Quantum/papers.md"),
      makeChunk("Finanzas/reporte.md"),
    ];
    const agentPerms = ["/Quantum/**"];

    const results = store.filterByPaths(chunks, agentPerms);
    expect(results).toHaveLength(1);
    expect(results[0].chunk.note_path).toBe("Quantum/papers.md");
  });

  it("no agentPerms → only pathFilter applies", () => {
    const store = new VectorStore();
    const chunks = [
      makeChunk("Research/nota.md"),
      makeChunk("Docs/readme.md"),
    ];
    const pathFilter = ["/Research/**"];

    const results = store.filterByPaths(chunks, pathFilter);
    expect(results).toHaveLength(1);
  });

  it("neither filter active → all chunks pass", () => {
    const store = new VectorStore();
    const chunks = [
      makeChunk("Research/nota.md"),
      makeChunk("Finanzas/reporte.md"),
      makeChunk("Quantum/papers.md"),
    ];

    // No pathFilter, no agentPerms
    const results = store.filterByPaths(chunks, []);
    expect(results).toHaveLength(3);
  });
});

// ============================================================
// Brecha #4 — KG expansion re-filter
// ============================================================

describe("Brecha #4 — KG expansion neighbor filtering", () => {
  it("KG neighbor chunk from restricted path is excluded", () => {
    const store = new VectorStore();
    const seedChunks = [
      makeChunk("Research/nota-a.md"),
    ];
    const kgNeighborChunk = makeChunk("Finanzas/reporte.md"); // restricted neighbor

    const agentPerms = ["/Research/**"];
    // Simulate combined results (RAG seed + KG neighbor)
    const allChunks = [...seedChunks, kgNeighborChunk];

    // Apply intersection filter to all chunks (RAG + KG)
    const filtered = store.filterByPaths(allChunks, agentPerms);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].chunk.note_path).toBe("Research/nota-a.md");
    // Finanzas/reporte.md was excluded even though it came via KG expansion
  });

  it("KG neighbor within allowed path passes filter", () => {
    const store = new VectorStore();
    const allChunks = [
      makeChunk("Research/nota-a.md"),
      makeChunk("Research/related-b.md"), // KG neighbor within same allowed path
    ];
    const agentPerms = ["/Research/**"];

    const filtered = store.filterByPaths(allChunks, agentPerms);
    expect(filtered).toHaveLength(2);
  });
});

// ============================================================
// Brecha #5 — Chain executor agent permissions
// ============================================================

describe("Brecha #5 — Agent permissions in chain context", () => {
  it("agent narrower read_paths restrict broader project read_paths", () => {
    const store = new VectorStore();
    const chunks = [
      makeChunk("Research/nota-a.md"),
      makeChunk("Docs/manual.md"),
      makeChunk("Research/nota-b.md"),
    ];
    const projectReadPaths = ["/Research/**", "/Docs/**"];   // project is broad
    const agentReadPaths = ["/Research/**"];                  // agent is narrow

    // Sequential filters = intersection: Research only
    let results = store.filterByPaths(chunks, projectReadPaths);
    expect(results).toHaveLength(3); // project alone allows all 3

    results = store.filterByPaths(results, agentReadPaths);
    expect(results).toHaveLength(2); // agent narrows to Research only
    expect(results.every(r => r.chunk.note_path.startsWith("Research/"))).toBe(true);
  });

  it("agent with /** read_paths doesn't restrict project filter", () => {
    const store = new VectorStore();
    const chunks = [makeChunk("Research/a.md"), makeChunk("Docs/b.md")];
    const projectReadPaths = ["/Research/**"];
    const agentReadPaths = ["/**"];

    let results = store.filterByPaths(chunks, projectReadPaths);
    expect(results).toHaveLength(1); // project narrows to Research

    results = store.filterByPaths(results, agentReadPaths);
    expect(results).toHaveLength(1); // agent /** doesn't add back removed chunks
  });
});

// ============================================================
// Empty intersection warning
// ============================================================

describe("Empty intersection detection", () => {
  it("detects when combined filters eliminate all results", () => {
    const store = new VectorStore();
    const chunks = [
      makeChunk("Finanzas/a.md"),
      makeChunk("Finanzas/b.md"),
    ];
    const beforeCount = chunks.length;

    let results = store.filterByPaths(chunks, ["/Finanzas/**"]);
    results = store.filterByPaths(results, ["/Quantum/**"]);

    expect(results).toHaveLength(0);
    // The warning is logged by agent-turn.ts; this test verifies the filter produces empty
    // In production, agent-turn.ts logs: `[Permissions] Filtro combinado vacío (${beforeCount} chunks descartados)`
  });
});

// ============================================================
// Original kg.test.ts compatibility check
// ============================================================

describe("cosineSimilarity (KG compatibility)", () => {
  it("KG tests still importable", async () => {
    const { cosineSimilarity } = await import("./rag/vector-store");
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});

// ============================================================
// Internal path exclusion (system folders must not be indexed)
// ============================================================

describe("isInternalPath", () => {
  it("flags sanctum-agents as internal", () => {
    expect(isInternalPath("sanctum-agents/forager.md")).toBe(true);
  });

  it("flags sanctum-skills as internal", () => {
    expect(isInternalPath("sanctum-skills/deep-research.md")).toBe(true);
  });

  it("flags sanctum- prefixed paths at any depth", () => {
    expect(isInternalPath("sanctum-memory/project-id/memory.jsonl")).toBe(true);
  });

  it("flags docs/ as internal", () => {
    expect(isInternalPath("docs/registro-arquitectura.md")).toBe(true);
  });

  it("does NOT flag user content paths", () => {
    expect(isInternalPath("Research/nota.md")).toBe(false);
  });

  it("does NOT flag paths that coincidentally contain sanctum- in name", () => {
    expect(isInternalPath("Research/sanctum-notes.md")).toBe(false);
  });
});

describe("RAG indexer — internal path exclusion", () => {
  it("sanctum-agents/ files are filtered out of allFiles before indexing", () => {
    // Simulate the filter that indexProject applies
    const allFiles = [
      "Research/nota.md",
      "sanctum-agents/forager.md",
      "sanctum-skills/deep-research.md",
      "docs/readme.md",
      "Research/paper.md",
    ];
    const filtered = allFiles.filter(f => !isInternalPath(f));
    expect(filtered).toEqual(["Research/nota.md", "Research/paper.md"]);
    expect(filtered).not.toContain("sanctum-agents/forager.md");
    expect(filtered).not.toContain("sanctum-skills/deep-research.md");
    expect(filtered).not.toContain("docs/readme.md");
  });

  it("orchestrator.md is explicitly excluded", () => {
    expect(isInternalPath("sanctum-agents/orchestrator.md")).toBe(true);
    expect(isInternalPath("sanctum-agents/critic.md")).toBe(true);
    expect(isInternalPath("sanctum-agents/forager.md")).toBe(true);
    expect(isInternalPath("sanctum-agents/researcher.md")).toBe(true);
  });
});

describe("KG explicit edges — internal path exclusion", () => {
  it("wikilinks to internal paths are excluded from explicit edges", async () => {
    const { getExplicitEdges } = await import("./kg/native-links");

    const mockProvider = {
      getResolvedLinks: () => ({
        "Research/nota.md": { "Research/other.md": 1, "sanctum-agents/forager.md": 1 },
        "sanctum-agents/forager.md": { "sanctum-agents/researcher.md": 1 },
        "docs/readme.md": { "Research/nota.md": 1 },
      }),
    };

    const edges = getExplicitEdges(mockProvider);

    // Should have edge between normal notes
    expect(edges.some(e =>
      e.from === "Research/nota.md" && e.to === "Research/other.md"
    )).toBe(true);

    // Should NOT have edge from user note to internal path
    expect(edges.some(e =>
      (e.from === "Research/nota.md" && e.to === "sanctum-agents/forager.md") ||
      (e.to === "Research/nota.md" && e.from === "sanctum-agents/forager.md")
    )).toBe(false);

    // Should NOT have edges between two internal paths
    expect(edges.some(e =>
      e.from === "sanctum-agents/forager.md" && e.to === "sanctum-agents/researcher.md"
    )).toBe(false);

    // Should NOT have edge from docs to user note
    expect(edges.some(e =>
      (e.from === "docs/readme.md" && e.to === "Research/nota.md") ||
      (e.to === "docs/readme.md" && e.from === "Research/nota.md")
    )).toBe(false);
  });

  it("normal user wikilinks still generate edges", async () => {
    const { getExplicitEdges } = await import("./kg/native-links");

    const mockProvider = {
      getResolvedLinks: () => ({
        "Research/a.md": { "Research/b.md": 1, "Projects/c.md": 3 },
        "Projects/c.md": { "Research/a.md": 1 },
      }),
    };

    const edges = getExplicitEdges(mockProvider);
    expect(edges).toHaveLength(2);
    expect(edges.every(e => e.type === "explicit")).toBe(true);
    expect(edges.every(e => e.weight === 1.0)).toBe(true);
  });
});
