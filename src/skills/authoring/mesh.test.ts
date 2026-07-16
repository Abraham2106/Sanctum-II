import { describe, expect, it, vi } from "vitest";
import type { VaultAdapter } from "../../core/vault-adapter";
import { GeminiBalancer } from "../../embeddings/gemini-balancer";
import { Tracer } from "../../observability/tracer";
import { defaultProject } from "../../projects/types";
import { VectorStore } from "../../rag/vector-store";
import type { TavilyResponse } from "../../tools/tavily";
import { parseSkillCriticEvaluation, SkillAuthoringMesh } from "./mesh";
import type { SkillAuthoringProgress } from "./types";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
  Notice: class Notice {},
}));

class MemoryVault implements VaultAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  async read(path: string): Promise<string> { const value = this.files.get(path); if (value === undefined) throw new Error("not found"); return value; }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async mkdir(path: string): Promise<void> { this.folders.add(path); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path}/`;
    return { files: [...this.files.keys()].filter(file => file.startsWith(prefix)), folders: [] };
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path); }
}

function agent(id: string, marker: string, tools: string[] = []): string {
  return `---\nid: ${id}\nname: ${id}\ninternal: true\ndescription: test\ntools: [${tools.join(", ")}]\npermissions:\n  read_paths: ${tools.includes("rag_query") ? '["/**"]' : "[]"}\n  write_paths: []\n---\n${marker}\n\nRAG:\n{{rag_context}}\n\nWEB:\n{{web_context}}\n\nINPUT:\n{{user_prompt}}`;
}

function seedDefinitions(vault: MemoryVault): void {
  vault.files.set("sanctum-agents/skill-context-analyst.md", agent("skill-context-analyst", "CONTEXT_ANALYST", ["rag_query"]));
  vault.files.set("sanctum-agents/skill-web-researcher.md", agent("skill-web-researcher", "WEB_RESEARCHER", ["web_search"]));
  vault.files.set("sanctum-agents/skill-author.md", agent("skill-author", "SKILL_AUTHOR"));
  vault.files.set("sanctum-agents/skill-critic.md", agent("skill-critic", "SKILL_CRITIC"));
  vault.files.set("sanctum-skills/skill-creator.md", `---\nid: skill-creator\nname: Skill Creator\ndescription: test\ntools: []\n---\nCREATOR_GUIDE\n{{user_prompt}}`);
}

const goodDraft = {
  id: "quantum-optimization-coder",
  name: "Quantum Optimization Coder",
  description: "Diseña implementaciones Python reproducibles de QUBO, Ising y QAOA cuando se necesite resolver optimización cuántica.",
  tools: ["rag_query", "web_search"],
  instructions: `# Rol y alcance\nDiseña implementaciones reproducibles de optimización cuántica.\n\n## Flujo interno\n1. Formula restricciones como penalizaciones QUBO.\n2. Verifica el mapeo binario a Ising.\n3. Selecciona Qiskit o PennyLane y documenta versión, backend, shots y semilla.\n4. Construye QAOA con mixer, ansatz, profundidad p y optimizador explícitos.\n\n## Validación\n- Compara energía y factibilidad contra un solver clásico para instancias pequeñas.\n- Rechaza soluciones que violen restricciones aunque tengan menor energía.\n- Ejecuta comprobaciones sintácticas y conserva resultados reproducibles.\n\n## Salida\nEntrega dependencias, formulación matemática, código Python tipado, pruebas, parámetros y limitaciones del backend.\n\n## Ambigüedad y fallos\nPregunta por variables y restricciones ausentes; si debes asumir, enumera cada supuesto. No prometas ventaja cuántica ni compatibilidad de versiones sin evidencia.\n\nPedido:\n{{user_prompt}}`,
};

function criticPayload(high = true): string {
  const scores = high ? [18, 18, 18, 18, 9, 9] : [8, 9, 8, 10, 4, 5];
  const names = ["contextual_grounding", "domain_accuracy", "web_currentness", "sanctum_contract", "edge_cases_output", "clarity_density"];
  return JSON.stringify({
    criteria: names.map((name, index) => ({ name, score: scores[index], note: high ? "cumple" : "insuficiente" })),
    feedback: high ? [] : ["Añade validación clásica, versiones, backend, shots y semillas."],
  });
}

function webResponse(): TavilyResponse {
  return {
    answer: "QAOA requiere definir operador de costo, mixer y optimización clásica.",
    results: [
      { title: "Qiskit QAOA", url: "https://qiskit.org/docs/qaoa", content: "QAOA, Sampler, backend y optimizadores.", score: 0.95 },
      { title: "PennyLane QAOA", url: "https://docs.pennylane.ai/qaoa", content: "Cost Hamiltonian y mixer Hamiltonian.", score: 0.9 },
    ],
  };
}

function makeHarness(options: {
  criticHighAfter?: number;
  ragMatch?: boolean;
  ragPath?: string;
  emptyIndex?: boolean;
  existing?: boolean;
  hasGeminiKeys?: boolean;
  tavilyKey?: string | null;
} = {}) {
  const vault = new MemoryVault();
  seedDefinitions(vault);
  if (options.existing) vault.files.set("sanctum-skills/quantum-optimization-coder.md", "skill anterior deplorable");
  const vectorStore = new VectorStore("test.jsonl");
  if (!options.emptyIndex) {
    vectorStore.addChunks([{
      id: "qaoa#0",
      note_path: options.ragPath || "Research/Quantum Optimization/QAOA.md",
      chunk_text: "El proyecto formula restricciones con QUBO, mapea a Ising y valida QAOA contra soluciones clásicas.",
      embedding: options.ragMatch === false ? [-1, 0] : [1, 0],
    }], options.ragPath || "Research/Quantum Optimization/QAOA.md");
  }
  const project = defaultProject("quantum");
  project.read_paths = ["/Research/Quantum Optimization/**"];
  project.rag.top_k = 5;
  project.rag.min_similarity = 0.65;
  let criticCalls = 0;
  const authorPackets: string[] = [];
  const chat = vi.fn(async (messages: { role: string; content: string }[]) => {
    const system = messages[0].content;
    const user = messages[1].content;
    if (system.includes("CONTEXT_ANALYST")) return { content: JSON.stringify({ topic: "QAOA e Ising", vault_findings: ["QUBO e Ising"], project_conventions: ["validación clásica"], gaps: ["APIs vigentes"], web_query: "QAOA official docs" }), usage: { prompt: 1, completion: 1 } };
    if (system.includes("WEB_RESEARCHER")) return { content: "Usa documentación oficial de Qiskit y PennyLane; fija backend, shots, semillas y versiones.", usage: { prompt: 1, completion: 1 } };
    if (system.includes("SKILL_AUTHOR")) { authorPackets.push(user); return { content: JSON.stringify(goodDraft), usage: { prompt: 1, completion: 1 } }; }
    if (system.includes("SKILL_CRITIC")) { criticCalls++; return { content: criticPayload(criticCalls >= (options.criticHighAfter || 1)), usage: { prompt: 1, completion: 1 } }; }
    throw new Error("agente inesperado");
  });
  const progress: SkillAuthoringProgress[] = [];
  const searchWeb = vi.fn(async () => webResponse());
  const mesh = new SkillAuthoringMesh({
    adapter: vault,
    opencodeClient: { chat } as any,
    geminiBalancer: { hasKeys: options.hasGeminiKeys !== false, embed: vi.fn(async () => [1, 0]) } as unknown as GeminiBalancer,
    vectorStore,
    tracer: new Tracer(vault),
    tavilyApiKey: options.tavilyKey === null ? undefined : options.tavilyKey || "test",
    projectContext: { project, memory: [], systemPrefix: "" },
    onProgress: item => progress.push(item),
    searchWeb,
  });
  return { vault, mesh, chat, progress, searchWeb, authorPackets };
}

const quantumBrief = "crea una skill para programar optimización cuántica, QAOA e Ising en Python con estándares de calidad";

describe("SkillAuthoringMesh", () => {
  it("exige 14/20 en completitud y actualidad web aunque el total supere 85", () => {
    const payload = JSON.parse(criticPayload(true));
    payload.criteria.find((item: { name: string }) => item.name === "web_currentness").score = 13;
    const evaluation = parseSkillCriticEvaluation(JSON.stringify(payload));
    expect(evaluation.totalScore).toBe(85);
    expect(evaluation.accepted).toBe(false);
  });

  it("ejecuta RAG → web → autor → crítico y no copia tools de autoría", async () => {
    const { mesh, vault, progress, authorPackets } = makeHarness();
    const result = await mesh.run({ description: quantumBrief });

    expect(result.status).toBe("accepted");
    expect(result.score).toBe(90);
    expect(result.ragSources).toHaveLength(1);
    expect(result.webSources).toHaveLength(2);
    expect(result.generation.skill.tools).toEqual([]);
    expect(await vault.read("sanctum-skills/quantum-optimization-coder.md")).toContain("solver clásico");
    expect(authorPackets[0]).toContain("QUBO, mapea a Ising");
    expect(authorPackets[0]).toContain("Qiskit y PennyLane");
    expect(progress.map(item => item.stage)).toEqual(expect.arrayContaining(["rag", "web", "author", "critic", "done"]));
  });

  it("acepta cero coincidencias semánticas sin introducir chunks irrelevantes", async () => {
    const { mesh, authorPackets } = makeHarness({ ragMatch: false });
    const result = await mesh.run({ description: quantumBrief });
    expect(result.ragSources).toEqual([]);
    expect(authorPackets[0]).toContain("Sin evidencia local relacionada");
  });

  it("bloquea un índice vacío antes de investigar o guardar", async () => {
    const { mesh, vault, searchWeb } = makeHarness({ emptyIndex: true });
    await expect(mesh.run({ description: quantumBrief })).rejects.toMatchObject({ code: "RAG_INDEX_EMPTY" });
    expect(searchWeb).not.toHaveBeenCalled();
    expect(vault.files.has("sanctum-skills/quantum-optimization-coder.md")).toBe(false);
  });

  it("bloquea la autoría cuando Gemini no puede consultar el índice", async () => {
    const { mesh, searchWeb, vault } = makeHarness({ hasGeminiKeys: false });
    await expect(mesh.run({ description: quantumBrief })).rejects.toMatchObject({ code: "RAG_KEYS_REQUIRED" });
    expect(searchWeb).not.toHaveBeenCalled();
    expect(vault.files.has("sanctum-skills/quantum-optimization-coder.md")).toBe(false);
  });

  it("respeta read_paths del proyecto aunque exista un chunk semánticamente relevante", async () => {
    const { mesh, authorPackets } = makeHarness({ ragPath: "Private/Other Project/QAOA.md" });
    const result = await mesh.run({ description: quantumBrief });
    expect(result.ragSources).toEqual([]);
    expect(authorPackets[0]).toContain("Sin evidencia local relacionada");
  });

  it("bloquea antes de Tavily cuando falta su credencial obligatoria", async () => {
    const { mesh, searchWeb, vault } = makeHarness({ tavilyKey: null });
    await expect(mesh.run({ description: quantumBrief })).rejects.toMatchObject({ code: "TAVILY_REQUIRED" });
    expect(searchWeb).not.toHaveBeenCalled();
    expect(vault.files.has("sanctum-skills/quantum-optimization-coder.md")).toBe(false);
  });

  it("regenera con feedback y guarda solo después de aprobar", async () => {
    const { mesh, vault, authorPackets } = makeHarness({ criticHighAfter: 2 });
    const result = await mesh.run({ description: quantumBrief });
    expect(result.attempts).toBe(2);
    expect(authorPackets[1]).toContain("Añade validación clásica");
    expect(vault.files.has("sanctum-skills/quantum-optimization-coder.md")).toBe(true);
  });

  it("escala luego de tres rechazos y no escribe el borrador", async () => {
    const { mesh, vault } = makeHarness({ criticHighAfter: 99 });
    const result = await mesh.run({ description: quantumBrief });
    expect(result.status).toBe("escalated");
    expect(result.attempts).toBe(3);
    expect(vault.files.has("sanctum-skills/quantum-optimization-coder.md")).toBe(false);
  });

  it("actualiza únicamente tras aprobar y archiva la versión anterior", async () => {
    const { mesh, vault } = makeHarness({ existing: true });
    const result = await mesh.run({ mode: "update", targetId: "quantum-optimization-coder", description: quantumBrief });
    expect(result.status).toBe("accepted");
    expect(result.saved?.historyPath).toBeDefined();
    expect(await vault.read(result.saved!.historyPath!)).toBe("skill anterior deplorable");
    expect(await vault.read("sanctum-skills/quantum-optimization-coder.md")).toContain("# Rol y alcance");
  });

  it("reintenta una búsqueda web vacía y bloquea si continúa sin fuentes", async () => {
    const { mesh, searchWeb, vault } = makeHarness();
    searchWeb.mockResolvedValue({ results: [] });
    await expect(mesh.run({ description: quantumBrief })).rejects.toMatchObject({ code: "WEB_RESULTS_EMPTY" });
    expect(searchWeb).toHaveBeenCalledTimes(2);
    expect(vault.files.has("sanctum-skills/quantum-optimization-coder.md")).toBe(false);
  });
});
