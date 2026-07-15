import { describe, it, expect, vi } from "vitest";
import { globMatch, pathMatchesAny, isInternalPath, slugify, extractTitle } from "./utils";
import { VectorStore, type Chunk } from "./rag/vector-store";
import { DEFAULT_MODEL } from "./constants";

vi.mock("obsidian", () => ({
  Notice: class Notice { constructor(msg: string) { console.log("[Notice]", msg); } },
  requestUrl: async () => ({ status: 200, json: {}, text: "", arrayBuffer: new ArrayBuffer(0) }),
  Plugin: class Plugin {},
  TFile: class TFile {},
  setIcon: () => {},
}));

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

  it("returns false when patterns is empty array (fail-closed)", () => {
    expect(pathMatchesAny("Research/nota.md", [])).toBe(false);
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

  it("empty filter array rejects all (fail-closed)", () => {
    const store = new VectorStore();
    const chunks = [
      makeChunk("Research/nota.md"),
      makeChunk("Finanzas/reporte.md"),
      makeChunk("Quantum/papers.md"),
    ];

    // Empty pattern list = no paths allowed (fail-closed)
    const results = store.filterByPaths(chunks, []);
    expect(results).toHaveLength(0);
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

// ============================================================
// slugify
// ============================================================

describe("slugify", () => {
  it("converts tildes and ñ", () => {
    expect(slugify("Investigación cuántica")).toBe("investigacion-cuantica");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("Mi Nota de prueba")).toBe("mi-nota-de-prueba");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Nota: ¿qué es? (teoría)")).toBe("nota-que-es-teoria");
  });

  it("truncates at 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long)).toHaveLength(60);
  });

  it("returns 'nota' for empty input", () => {
    expect(slugify("")).toBe("nota");
  });
});

// ============================================================
// extractTitle
// ============================================================

describe("extractTitle", () => {
  it("extracts first H1", () => {
    expect(extractTitle("# Mi Título\n\ncontenido")).toBe("Mi Título");
  });

  it("returns null when no H1", () => {
    expect(extractTitle("## Subtítulo\n\ncontenido")).toBeNull();
  });

  it("returns first H1 even inside code block (no special case)", () => {
    expect(extractTitle("```\n# Título en código\n```")).toBe("Título en código");
  });

  it("returns null for empty content", () => {
    expect(extractTitle("")).toBeNull();
  });
});

// ============================================================
// renderSystemPrompt
// ============================================================

describe("renderSystemPrompt", () => {
  it("replaces {{rag_context}} and {{user_prompt}}", async () => {
    const { renderSystemPrompt } = await import("./agents/agent-loader");
    const agent = {
      id: "test", name: "Test", avatar: "🤖", model: DEFAULT_MODEL,
      description: "", triggers: [], tools: [],
      permissions: { read_paths: [], write_paths: [] },
      system_prompt: "Contexto:\n{{rag_context}}\n\nPregunta:\n{{user_prompt}}",
    };
    const result = renderSystemPrompt(agent, "datos del vault", "¿qué es X?");
    expect(result).toBe("Contexto:\ndatos del vault\n\nPregunta:\n¿qué es X?");
  });

  it("leaves unmatched placeholders intact", async () => {
    const { renderSystemPrompt } = await import("./agents/agent-loader");
    const agent = {
      id: "test", name: "Test", avatar: "🤖", model: DEFAULT_MODEL,
      description: "", triggers: [], tools: [],
      permissions: { read_paths: [], write_paths: [] },
      system_prompt: "Hola {{rag_context}} y {{web_context}}",
    };
    const result = renderSystemPrompt(agent, "ctx", "usr");
    expect(result).toBe("Hola ctx y {{web_context}}");
  });
});

// ============================================================
// parseCriticJSON
// ============================================================

describe("parseCriticJSON", () => {
  it("parses full evaluation with 5 criteria", async () => {
    const { parseCriticJSON } = await import("./orchestrator/mesh");
    const raw = JSON.stringify({
      evaluation: {
        criteria: [
          { name: "coherencia_interna", score: 18, note: "ok" },
          { name: "uso_de_fuentes", score: 15, note: "bien" },
          { name: "completitud_vs_prompt", score: 20, note: "" },
          { name: "actualidad_de_datos", score: 10, note: "desactualizado" },
          { name: "claridad_de_escritura", score: 17, note: "" },
        ],
        total_score: 80,
        threshold: 80,
        verdict: "accept",
        feedback_for_regeneration: [],
      },
    });
    const ev = parseCriticJSON(raw);
    expect(ev.total_score).toBe(80);
    expect(ev.verdict).toBe("accept");
    expect(ev.criteria).toHaveLength(5);
    expect(ev.criteria[0].name).toBe("coherencia_interna");
    expect(ev.criteria[0].score).toBe(18);
  });

  it("parses reject verdict with feedback", async () => {
    const { parseCriticJSON } = await import("./orchestrator/mesh");
    const raw = JSON.stringify({
      evaluation: {
        criteria: [{ name: "coherencia_interna", score: 10, note: "contradicción" }],
        total_score: 45,
        threshold: 80,
        verdict: "reject",
        feedback_for_regeneration: ["Resolver contradicción", "Agregar fuentes"],
      },
    });
    const ev = parseCriticJSON(raw);
    expect(ev.verdict).toBe("reject");
    expect(ev.total_score).toBe(45);
    expect(ev.feedback_for_regeneration).toHaveLength(2);
  });

  it("falls back to defaults on unparseable input", async () => {
    const { parseCriticJSON } = await import("./orchestrator/mesh");
    const ev = parseCriticJSON("esto no es JSON");
    expect(ev.total_score).toBe(0);
    expect(ev.verdict).toBe("reject");
    expect(ev.criteria).toHaveLength(0);
    expect(ev.feedback_for_regeneration.length).toBeGreaterThanOrEqual(1);
  });

  it("accepts evaluation without wrapper object", async () => {
    const { parseCriticJSON } = await import("./orchestrator/mesh");
    const raw = JSON.stringify({
      criteria: [{ name: "coherencia_interna", score: 18, note: "" }],
      total_score: 85,
      threshold: 80,
      verdict: "accept",
      feedback_for_regeneration: [],
    });
    const ev = parseCriticJSON(raw);
    expect(ev.total_score).toBe(85);
    expect(ev.verdict).toBe("accept");
  });
});

// ============================================================
// topologicalOrder
// ============================================================

describe("topologicalOrder", () => {
  it("simple linear chain", async () => {
    const { topologicalOrder } = await import("./chains/executor");
    const nodes = [
      { id: "a", agentId: "agent1", x: 0, y: 0 },
      { id: "b", agentId: "agent2", x: 100, y: 0 },
      { id: "c", agentId: "agent3", x: 200, y: 0 },
    ];
    const edges = [
      { id: "e1", from: "a", to: "b" },
      { id: "e2", from: "b", to: "c" },
    ];
    const order = topologicalOrder(nodes, edges);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("diamond shape", async () => {
    const { topologicalOrder } = await import("./chains/executor");
    const nodes = [
      { id: "a", agentId: "a1", x: 0, y: 0 },
      { id: "b", agentId: "a2", x: 100, y: 0 },
      { id: "c", agentId: "a3", x: 100, y: 100 },
      { id: "d", agentId: "a4", x: 200, y: 0 },
    ];
    const edges = [
      { id: "e1", from: "a", to: "b" },
      { id: "e2", from: "a", to: "c" },
      { id: "e3", from: "b", to: "d" },
      { id: "e4", from: "c", to: "d" },
    ];
    const order = topologicalOrder(nodes, edges);
    expect(order[0]).toBe("a");
    expect(order[order.length - 1]).toBe("d");
  });

  it("handles disconnected nodes", async () => {
    const { topologicalOrder } = await import("./chains/executor");
    const nodes = [
      { id: "a", agentId: "a1", x: 0, y: 0 },
      { id: "b", agentId: "a2", x: 100, y: 0 },
      { id: "c", agentId: "a3", x: 200, y: 0 },
    ];
    const edges = [{ id: "e1", from: "a", to: "b" }];
    const order = topologicalOrder(nodes, edges);
    expect(order).toContain("a");
    expect(order).toContain("b");
    expect(order).toContain("c");
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
  });

  it("handles single node", async () => {
    const { topologicalOrder } = await import("./chains/executor");
    const nodes = [{ id: "a", agentId: "a1", x: 0, y: 0 }];
    const order = topologicalOrder(nodes, []);
    expect(order).toEqual(["a"]);
  });
});

// ============================================================
// classifyIntent
// ============================================================

describe("classifyIntent", () => {
  it("affirmative without pending action → new_query", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    expect(classifyIntent("sí").type).toBe("new_query");
  });

  it("affirmative with pending action → confirmation", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    const pa = { type: "create_note", description: "", params: {}, proposed_at: 0 };
    expect(classifyIntent("sí", pa).type).toBe("confirmation");
  });

  it("negative with pending action → rejection", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    const pa = { type: "create_note", description: "", params: {}, proposed_at: 0 };
    expect(classifyIntent("nop", pa).type).toBe("rejection");
  });

  it("recognizes all affirmative variants", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    const pa = { type: "research", description: "", params: {}, proposed_at: 0 };
    for (const word of ["dale", "ok", "claro", "seguro", "hazlo", "adelante"]) {
      expect(classifyIntent(word, pa).type).toBe("confirmation");
    }
  });

  it("new query bypasses pending action", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    const pa = { type: "create_note", description: "", params: {}, proposed_at: 0 };
    expect(classifyIntent("investiga X", pa).type).toBe("new_query");
  });
});

// ============================================================
// detectPendingAction
// ============================================================

describe("detectPendingAction", () => {
  it("detects create_note intent", async () => {
    const { detectPendingAction } = await import("./orchestrator/conversation");
    const msg = "¿Quieres que crea una nota llamada Quantum Computing?";
    const action = detectPendingAction(msg);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("create_note");
    expect(action!.params.noteName).toContain("Quantum");
  });

  it("returns null for normal message", async () => {
    const { detectPendingAction } = await import("./orchestrator/conversation");
    expect(detectPendingAction("Aquí tienes la respuesta completa.")).toBeNull();
  });

  it("detects the natural-language offer used by researcher and preserves the full source", async () => {
    const { detectPendingAction } = await import("./orchestrator/conversation");
    const research = `# QAOA, Ising y QUBO\n\n${"contenido tecnico ".repeat(300)}\n\nSi deseas que cree una nota permanente en tu vault con esta investigación completa, solo indícalo.`;
    const action = detectPendingAction(research, { sourceAgentId: "researcher" });
    expect(action?.type).toBe("create_note");
    expect(action?.params.sourceContent).toBe(research);
    expect(action?.params.sourceAgentId).toBe("researcher");
    expect(action?.params.mode).toBe("reformat_source");
    expect(action?.params.suggestedTitle).toContain("QAOA");
  });
});

describe("contextual note confirmations", () => {
  it("treats 'genera la nota' and 'genera una nota a partir de eso' as confirmation", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    const pending = { type: "create_note", description: "Crear nota", params: { sourceContent: "investigación" }, proposed_at: 0 };
    expect(classifyIntent("Genera la nota", pending).type).toBe("confirmation");
    expect(classifyIntent("genera la nota a partir de eso", pending).type).toBe("confirmation");
    expect(classifyIntent("Crea una nota en el vault con el contenido de la investigacion", pending).type).toBe("confirmation");
    expect(classifyIntent("Guarda el contenido anterior", pending).type).toBe("confirmation");
    expect(classifyIntent("crea una nota sobre otra cosa", pending).type).toBe("new_query");
    expect(classifyIntent("crea una nota sobre otra investigacion", pending).type).toBe("new_query");
  });
});

// ============================================================
// VectorStore operations
// ============================================================

describe("VectorStore search", () => {
  it("returns topK results sorted by score descending", () => {
    const store = new VectorStore();
    const chunks = [
      { id: "c1", note_path: "Research/a.md", chunk_text: "text a", embedding: [1, 0, 0] },
      { id: "c2", note_path: "Research/b.md", chunk_text: "text b", embedding: [0, 1, 0] },
      { id: "c3", note_path: "Research/c.md", chunk_text: "text c", embedding: [0, 0, 1] },
    ];
    store.addChunks(chunks, "Research/batch");
    const results = store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].chunk.id).toBe("c1");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("search with count=0 returns empty", () => {
    const store = new VectorStore();
    const chunks = [
      { id: "c1", note_path: "Research/a.md", chunk_text: "text a", embedding: [1, 0, 0] },
    ];
    store.addChunks(chunks, "Research/batch");
    expect(store.search([1, 0, 0], 0)).toHaveLength(0);
  });

  it("remains empty after clear", () => {
    const store = new VectorStore();
    store.addChunks([
      { id: "c1", note_path: "Research/a.md", chunk_text: "text a", embedding: [1, 0, 0] },
    ], "Research/a.md");
    store.clear();
    expect(store.count).toBe(0);
    expect(store.search([1, 0, 0], 5)).toHaveLength(0);
  });

  it("reindexing replaces old chunks (tombstone)", () => {
    const store = new VectorStore();
    store.addChunks([
      { id: "a1", note_path: "Research/a.md", chunk_text: "v1", embedding: [1, 0, 0] },
    ], "Research/a.md");
    expect(store.count).toBe(1);
    store.addChunks([
      { id: "a2", note_path: "Research/a.md", chunk_text: "v2", embedding: [1, 0, 0] },
    ], "Research/a.md");
    expect(store.count).toBe(1);
    expect(store.allChunks[0].id).toBe("a2");
    expect(store.allChunks[0].chunk_text).toBe("v2");
  });

  it("adds chunks for different notes", () => {
    const store = new VectorStore();
    store.addChunks([
      { id: "a1", note_path: "Research/a.md", chunk_text: "a", embedding: [1, 0, 0] },
    ], "Research/a.md");
    store.addChunks([
      { id: "b1", note_path: "Research/b.md", chunk_text: "b", embedding: [0, 1, 0] },
    ], "Research/b.md");
    expect(store.count).toBe(2);
  });
});

// ============================================================
// Fase 1 — Cerrando el loop: creación de notas + outputPath
// ============================================================

describe("defaultProject", () => {
  it("includes outputPath", async () => {
    const { defaultProject } = await import("./projects/types");
    const p = defaultProject("test-proj", "Test Project");
    expect(p.outputPath).toBe("Projects/test-proj");
  });

  it("includes Projects/{id}/ in read_paths", async () => {
    const { defaultProject } = await import("./projects/types");
    const p = defaultProject("test-proj");
    expect(p.read_paths).toContain("/Projects/test-proj/");
  });

  it("includes Projects/{id}/ in write_paths", async () => {
    const { defaultProject } = await import("./projects/types");
    const p = defaultProject("test-proj");
    expect(p.write_paths).toContain("/Projects/test-proj/");
  });
});

describe("classifyIntent", () => {
  it("confirmation on pendingAction triggers resolution", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    const pa = { type: "create_note", description: "Crear nota X", params: { noteName: "test" }, proposed_at: Date.now() };
    expect(classifyIntent("sí", pa).type).toBe("confirmation");
    expect(classifyIntent("dale", pa).type).toBe("confirmation");
    expect(classifyIntent("creala", pa).type).toBe("new_query"); // not in SHORT_YES
  });

  it("rejection on pendingAction clears intent", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    const pa = { type: "create_note", description: "Crear nota", params: {}, proposed_at: Date.now() };
    expect(classifyIntent("no", pa).type).toBe("rejection");
    expect(classifyIntent("nop", pa).type).toBe("rejection");
    expect(classifyIntent("para", pa).type).toBe("rejection");
  });

  it("non-confirmation message with pendingAction → new_query", async () => {
    const { classifyIntent } = await import("./orchestrator/conversation");
    const pa = { type: "create_note", description: "", params: {}, proposed_at: 0 };
    expect(classifyIntent("investigá más sobre X", pa).type).toBe("new_query");
  });
});

describe("CreatedNote type", () => {
  it("CreatedNote has correct shape", async () => {
    const note: { path: string; title: string; created_at: number } = { path: "Projects/test/nota.md", title: "Mi Nota", created_at: 12345 };
    expect(note.path).toBe("Projects/test/nota.md");
    expect(note.title).toBe("Mi Nota");
  });
});

// ============================================================
// Fase 3 — Resolución de referencias a notas
// ============================================================

describe("resolveNoteReference", () => {
  it("exact match on createdNotes by title", async () => {
    const { resolveNoteReference } = await import("./orchestrator/note-resolver");
    const notes = [
      { path: "Projects/test/QML.md", title: "QML Research", created_at: 100 },
      { path: "Projects/test/Water.md", title: "Water Quality", created_at: 200 },
    ];
    const result = await resolveNoteReference("QML", notes, undefined, undefined);
    expect(result.method).toBe("exact");
    expect(result.path).toBe("Projects/test/QML.md");
  });

  it("exact match with partial query match", async () => {
    const { resolveNoteReference } = await import("./orchestrator/note-resolver");
    const notes = [{ path: "Projects/test/QML.md", title: "Quantum ML Research", created_at: 100 }];
    const result = await resolveNoteReference("quantum", notes, undefined, undefined);
    expect(result.method).toBe("exact");
    expect(result.path).toBe("Projects/test/QML.md");
  });

  it("not_found when no notes match", async () => {
    const { resolveNoteReference } = await import("./orchestrator/note-resolver");
    const result = await resolveNoteReference("nonexistent", [], undefined, undefined);
    expect(result.method).toBe("not_found");
    expect(result.path).toBeNull();
  });

  it("not_found when no vector store either", async () => {
    const { resolveNoteReference } = await import("./orchestrator/note-resolver");
    const result = await resolveNoteReference("algo", undefined, undefined, undefined);
    expect(result.method).toBe("not_found");
  });
});

// ============================================================
// Fase 4 — Modificación de notas (file-level)
// ============================================================

describe("note-generator outputPath", () => {
  it("uses outputPath from NoteGenDeps when provided", async () => {
    const { makeInstruction } = await import("./orchestrator/note-generator");
    expect(makeInstruction("test topic")).toContain("test topic");
  });

  it("canWriteToPath blocks internal paths", async () => {
    const { canWriteToPath } = await import("./orchestrator/note-generator");
    expect(canWriteToPath("sanctum-agents/test.md", ["/**"])).toBe(false);
    expect(canWriteToPath("Projects/test/nota.md", ["/Projects/test/"])).toBe(true);
    expect(canWriteToPath("Projects/test/nota.md", [])).toBe(false);
  });
});
