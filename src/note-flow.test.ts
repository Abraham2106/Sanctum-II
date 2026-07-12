import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatOrchestrator } from "./app/chat-orchestrator";

vi.mock("obsidian", () => ({
  Notice: class Notice { constructor(msg: string) { console.log("[Notice]", msg); } },
  requestUrl: async () => ({ status: 200, json: {}, text: "", arrayBuffer: new ArrayBuffer(0) }),
  Plugin: class Plugin {},
  TFile: class TFile {},
  setIcon: () => {},
}));

// Track the last call to executeWriteIntent to assert writePaths
const mockExecuteWriteIntent = vi.fn();
vi.mock("./orchestrator/note-generator", () => ({
  executeWriteIntent: (...args: any[]) => {
    mockExecuteWriteIntent(...args);
    return Promise.resolve("✏️ **Nota creada exitosamente**\n\n# Nota generada\n\ncontenido de prueba");
  },
  makeInstruction: vi.fn().mockReturnValue("test instruction"),
  canWriteToPath: vi.fn().mockReturnValue(true),
  createNoteAction: vi.fn(),
}));

// Mock loadAgentFromVault and renderSystemPrompt
vi.mock("./agents/agent-loader", () => ({
  loadAgentFromVault: vi.fn().mockResolvedValue({
    id: "orchestrator",
    system_prompt: "Eres el orquestador. {{user_prompt}}",
    name: "Orchestrator", avatar: "🎯", internal: true,
    description: "", triggers: [], tools: [],
    permissions: { read_paths: [], write_paths: [] },
  }),
  renderSystemPrompt: vi.fn().mockReturnValue("rendered prompt"),
}));

// Mock executeTurn (used in modify flow)
vi.mock("./orchestrator/agent-turn", () => ({
  executeTurn: vi.fn().mockResolvedValue({
    content: "# Contenido modificado\n\nNuevo texto de prueba",
    usage: { prompt: 10, completion: 20 },
    ragContext: "",
  }),
}));

const mockNoteWriter = { create: vi.fn(), update: vi.fn() };
const mockProjectStore = { loadThreadData: vi.fn(), saveThreadData: vi.fn() };
const mockAdapter = { read: vi.fn(), write: vi.fn(), exists: vi.fn(), list: vi.fn(), append: vi.fn() };
const mockVectorStore = { count: 0, search: vi.fn(), allChunks: [], filterByPaths: vi.fn(), getStorePath: vi.fn() };
const mockGemini = { hasKeys: false, embed: vi.fn(), keyCount: 0 };
const mockTracer = { start: vi.fn(), addChunk: vi.fn(), finish: vi.fn(), abort: vi.fn() };
const mockOpenCodeClient = { configured: true, chat: vi.fn() };
const mockChainStore = { load: vi.fn().mockResolvedValue(null) };
const mockKgEdgeStore = { count: 0, getAllEdges: vi.fn().mockReturnValue([]) };

const project = {
  id: "test-proj",
  name: "Test Project",
  icon: "◈",
  description: "",
  instructions: "",
  read_paths: ["/Research/**", "/Projects/test-proj/**"],
  write_paths: ["/Projects/test-proj/**", "/sanctum-memory/test-proj/**"],
  outputPath: "Projects/test-proj",
  model: "deepseek-v4-flash",
  rag: { embed_model: "gemini-embedding-2", dims: 768, chunk_words: 400, top_k: 5, min_similarity: 0.65 },
  files: [],
  attachedFiles: [],
};

const agent = {
  id: "agente_base", name: "Agente Base", avatar: "🤖", model: "deepseek-v4-flash",
  description: "", triggers: [], tools: [],
  permissions: { read_paths: ["/**"], write_paths: ["/**"] }, // Agent has unlimited write
  system_prompt: "Eres un asistente.",
};

function makeServices(overrides?: Record<string, any>): any {
  return {
    activeThreadId: "test-thread",
    activeProject: project,
    agent,
    opencodeClient: mockOpenCodeClient,
    noteWriter: mockNoteWriter,
    tracer: mockTracer,
    adapter: mockAdapter,
    geminiBalancer: mockGemini,
    vectorStore: mockVectorStore,
    projectStore: mockProjectStore,
    chainStore: mockChainStore,
    kgEdgeStore: mockKgEdgeStore,
    pathFilter: undefined as string[] | undefined,
    kgOptions: { enabled: false, minSimilarity: 0.75, hops: 1, maxNeighborsPerHop: 3, useExplicit: true, reinforceBoost: true },
    getSkills: vi.fn().mockResolvedValue([]),
    setSkillContext: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProjectStore.loadThreadData.mockReset();
  mockProjectStore.saveThreadData.mockReset();
  mockNoteWriter.create.mockReset();
  mockNoteWriter.update.mockReset();
  mockAdapter.read.mockReset();
  mockAdapter.exists.mockReset();
  mockOpenCodeClient.chat.mockReset();
});

describe("Integration — tryResolvePendingAction (creación de nota)", () => {
  it("confirmation con create_note usa write_paths del proyecto, no del agente", async () => {
    mockProjectStore.loadThreadData.mockResolvedValue({
      thread: { thread_id: "test", project_id: "test-proj", title: "Test", created_at: 0, updated_at: 0, starred: false },
      messages: [],
      pendingAction: {
        type: "create_note",
        description: 'Crear nota "test-note"',
        params: { noteName: "test-note", fullProposal: "Investigación sobre QML" },
        proposed_at: Date.now(),
      },
    });
    mockNoteWriter.create.mockResolvedValue({ success: true, message: "Nota creada", path: "Projects/test-proj/test-note.md" });
    mockAdapter.exists.mockResolvedValue(false);
    mockOpenCodeClient.chat.mockResolvedValue({ content: "# Nota de prueba\n\ncontenido", usage: { prompt: 10, completion: 20 } });

    const svc = makeServices();
    const orch = new ChatOrchestrator(svc);
    const response = await orch.handleMessage("sí");

    // 1) Verify the note creation was triggered
    expect(response.content).toContain("Nota creada exitosamente");

    // 2) CRITICAL: verify writePaths came from PROJECT, not from agent
    const firstCallArgs = mockExecuteWriteIntent.mock.calls[0];
    expect(firstCallArgs).toBeDefined();
    const deps = firstCallArgs[0];
    expect(deps.writePaths).toEqual(["/Projects/test-proj/**", "/sanctum-memory/test-proj/**"]);
    expect(deps.writePaths).not.toEqual(["/**"]); // NOT agent.permissions.write_paths
    expect(deps.outputPath).toBe("Projects/test-proj");

    // 3) Verify saveThreadData was called (createdNotes tracked in memory)
    expect(mockProjectStore.saveThreadData).toHaveBeenCalled();
  });
});

describe("Integration — handleImplicitMessage (clasificación de intención)", () => {
  function setupForAction(action: string, createdNotes?: any[]) {
    mockProjectStore.loadThreadData.mockResolvedValue({
      thread: { thread_id: "test", project_id: "test-proj", title: "Test", created_at: 0, updated_at: 0, starred: false },
      messages: [],
      pendingAction: undefined,
      createdNotes: createdNotes || [],
    });
    mockAdapter.read.mockImplementation((path: string) => {
      if (path === "sanctum-agents/orchestrator.md") {
        return Promise.resolve(loadAgentMdContent());
      }
      return Promise.reject(new Error("not found"));
    });
    mockAdapter.exists.mockResolvedValue(true);
    mockOpenCodeClient.chat.mockResolvedValue({
      content: JSON.stringify({ mode: "implicit", action, reason: "test" }),
      usage: { prompt: 5, completion: 5 },
    });
  }

  function loadAgentMdContent(): string {
    return `---\nid: orchestrator\ninternal: true\n---\nEres el orquestador.\n{{user_prompt}}`;
  }

  it("create_note → ejecuta creación sin re-parsear con regex (Bug 2 fix)", async () => {
    // Message that reaches handleImplicitMessage (no @, no writeIntent regex match).
    // The orchestrator classifies as create_note — should execute directly.
    setupForAction("create_note");
    mockNoteWriter.create.mockResolvedValue({ success: true, message: "Creada", path: "test.md" });
    mockAdapter.exists.mockResolvedValue(false);

    const svc = makeServices();
    const orch = new ChatOrchestrator(svc);
    const response = await orch.handleMessage("convertí esto en una nota del vault");

    // The orchestrator was invoked to classify
    expect(mockOpenCodeClient.chat).toHaveBeenCalled();
    // The note creation was triggered (proof the regex wasn't required)
    expect(mockExecuteWriteIntent).toHaveBeenCalled();
    expect(response).toBeDefined();
    expect(response.content).toContain("Nota creada");
  });

  it("respond_only → no dispara escritura ni modificación", async () => {
    setupForAction("respond_only");

    const svc = makeServices();
    const orch = new ChatOrchestrator(svc);
    const response = await orch.handleMessage("investigá el estado del arte de QML");

    expect(mockOpenCodeClient.chat).toHaveBeenCalled();
    // respond_only returns handleAgentMessage result, which is ChatResponse
    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
    // No write or note modification was triggered
    expect(mockNoteWriter.create).not.toHaveBeenCalled();
    expect(mockNoteWriter.update).not.toHaveBeenCalled();
  });

  it("clarify → devuelve mensaje sin ejecutar escritura", async () => {
    setupForAction("clarify");

    const svc = makeServices();
    const orch = new ChatOrchestrator(svc);
    const response = await orch.handleMessage("modificá la nota sobre QML");

    expect(mockOpenCodeClient.chat).toHaveBeenCalled();
    expect(response.content).toContain("darme más detalles");
    expect(mockNoteWriter.create).not.toHaveBeenCalled();
    expect(mockNoteWriter.update).not.toHaveBeenCalled();
  });
});

describe("Integration — modify_note (leer → regenerar → sobrescribir)", () => {
  it("nota encontrada → lee, regenera, sobrescribe con NoteWriter.update", async () => {
    mockProjectStore.loadThreadData.mockResolvedValue({
      thread: { thread_id: "test", project_id: "test-proj", title: "Test", created_at: 0, updated_at: 0, starred: false },
      messages: [],
      pendingAction: undefined,
      createdNotes: [{ path: "Projects/test-proj/QML.md", title: "QML Research", created_at: Date.now() }],
    });
    // orchestrator.md exists
    mockAdapter.read.mockImplementation((path: string) => {
      if (path === "sanctum-agents/orchestrator.md") {
        return Promise.resolve(`---\nid: orchestrator\ninternal: true\n---\nEres el orquestador.\n{{user_prompt}}`);
      }
      if (path === "Projects/test-proj/QML.md") {
        return Promise.resolve("# QML Research\n\n## Teoría\n\ncontenido existente\n\n## Desafíos\n\npendientes");
      }
      return Promise.reject(new Error("not found"));
    });
    mockAdapter.exists.mockResolvedValue(true);
    mockNoteWriter.update.mockResolvedValue({ success: true, message: "Nota actualizada", path: "Projects/test-proj/QML.md" });

    // Orchestrator says modify_note
    mockOpenCodeClient.chat.mockResolvedValue({
      content: JSON.stringify({ mode: "implicit", action: "modify_note", reason: "test", noteTarget: "QML" }),
      usage: { prompt: 5, completion: 5 },
    });

    const svc = makeServices();
    const orch = new ChatOrchestrator(svc);
    const response = await orch.handleMessage("en la nota QML Research que creaste, profundizá la sección de teoría");

    // The modification flow was triggered
    expect(mockNoteWriter.update).toHaveBeenCalled();
    const updateCall = mockNoteWriter.update.mock.calls[0];
    expect(updateCall[0]).toBe("Projects/test-proj/QML.md"); // correct path
    expect(updateCall[1]).toContain("Contenido modificado"); // modified content from LLM
    expect(response.content).toContain("Nota actualizada");
  });

  it("nota no encontrada → no modifica nada", async () => {
    mockProjectStore.loadThreadData.mockResolvedValue({
      thread: { thread_id: "test", project_id: "test-proj", title: "Test", created_at: 0, updated_at: 0, starred: false },
      messages: [],
      pendingAction: undefined,
      createdNotes: [],
    });
    mockAdapter.read.mockImplementation((path: string) => {
      if (path === "sanctum-agents/orchestrator.md") {
        return Promise.resolve(`---\nid: orchestrator\ninternal: true\n---\nEres el orquestador.\n{{user_prompt}}`);
      }
      return Promise.reject(new Error("not found"));
    });
    mockAdapter.exists.mockResolvedValue(true);

    // Orchestrator says modify_note but there's nothing to modify
    mockOpenCodeClient.chat.mockResolvedValue({
      content: JSON.stringify({ mode: "implicit", action: "modify_note", reason: "test" }),
      usage: { prompt: 5, completion: 5 },
    });

    const svc = makeServices();
    const orch = new ChatOrchestrator(svc);
    const response = await orch.handleMessage("en la nota que creaste, profundizá");

    expect(response.content).toContain("No encontré ninguna nota");
    expect(mockNoteWriter.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// Bug 1 — createdNotes persistence (saveThreadData preserves extra fields)
// ============================================================

describe("saveThreadData persistence", () => {
  it("preserva createdNotes luego de guardar sin extra (caso del OLD bug)", async () => {
    const { ProjectStore } = await import("./projects/store");
    const notes: any[] = [];
    const adapter = {
      read: vi.fn().mockImplementation((path: string) => {
        const saved = notes.find(n => n.path === path);
        return saved ? Promise.resolve(saved.content) : Promise.reject(new Error("not found"));
      }),
      write: vi.fn().mockImplementation((path: string, content: string) => {
        const idx = notes.findIndex(n => n.path === path);
        if (idx >= 0) notes[idx] = { path, content };
        else notes.push({ path, content });
        return Promise.resolve();
      }),
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    };
    const store = new ProjectStore(adapter as any);
    const projectId = "test-proj";
    const threadId = "test-thread";
    const threadData = {
      thread: { thread_id: threadId, project_id: projectId, title: "Test", created_at: 0, updated_at: 0, starred: false },
      messages: [{ role: "user", content: "hola" }],
      createdNotes: [{ path: "Projects/test-proj/nota.md", title: "nota", created_at: 1000 }],
    };

    // First save WITH createdNotes
    await store.saveThreadData(projectId, threadData.thread, threadData.messages, {
      createdNotes: threadData.createdNotes,
    });

    // Verify createdNotes is there
    let loaded = await store.loadThreadData(projectId, threadId);
    expect(loaded).not.toBeNull();
    expect(loaded!.createdNotes).toHaveLength(1);

    // Simulate OLD behavior: save WITHOUT extra (like the bug did)
    await store.saveThreadData(projectId, threadData.thread, threadData.messages);

    // Verify createdNotes survived
    loaded = await store.loadThreadData(projectId, threadId);
    expect(loaded!.createdNotes).toHaveLength(1);
    expect(loaded!.createdNotes![0].title).toBe("nota");
  });

  it("preserva summary y pendingAction al guardar sin extra", async () => {
    const { ProjectStore } = await import("./projects/store");
    const saved: Record<string, string> = {};
    const adapter = {
      read: vi.fn().mockImplementation((path: string) => {
        if (saved[path]) return Promise.resolve(saved[path]);
        return Promise.reject(new Error("not found"));
      }),
      write: vi.fn().mockImplementation((path: string, content: string) => {
        saved[path] = content;
        return Promise.resolve();
      }),
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    };
    const store = new ProjectStore(adapter as any);
    const projectId = "test-proj";
    const threadId = "test-thread";
    const td = {
      thread: { thread_id: threadId, project_id: projectId, title: "Test", created_at: 0, updated_at: 0, starred: false },
      messages: [],
      summary: "Conversación sobre QML",
      pendingAction: { type: "create_note", description: "Crear nota X", params: {}, proposed_at: 100 },
    };

    await store.saveThreadData(projectId, td.thread, td.messages, {
      summary: td.summary,
      pendingAction: td.pendingAction,
    });

    td.thread.updated_at = Date.now();
    await store.saveThreadData(projectId, td.thread, td.messages);

    const loaded = await store.loadThreadData(projectId, threadId);
    expect(loaded!.summary).toBe("Conversación sobre QML");
    expect(loaded!.pendingAction).toBeDefined();
    expect(loaded!.pendingAction!.type).toBe("create_note");
  });
});
