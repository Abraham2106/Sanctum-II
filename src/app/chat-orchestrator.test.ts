import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppServices } from "./services";
import { ChatOrchestrator } from "./chat-orchestrator";
import { DEFAULT_MODEL } from "../constants";
import { executeTurn } from "../orchestrator/agent-turn";

vi.mock("obsidian", () => ({
  Notice: class Notice {
    constructor(_msg: string) {}
  },
}));

vi.mock("../orchestrator/agent-turn", () => ({
  executeTurn: vi.fn().mockResolvedValue({
    content: "ok",
    usage: { prompt: 1, completion: 1 },
    ragContext: "",
  }),
}));

vi.mock("../orchestrator/note-generator", () => ({
  executeWriteIntent: vi.fn(),
  generateNoteFromSource: vi.fn(),
  canWriteToPath: vi.fn().mockReturnValue(true),
}));

vi.mock("../agents/agent-loader", () => ({
  loadAgentFromVault: vi.fn().mockRejectedValue(new Error("missing")),
}));

describe("ChatOrchestrator request snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps original project scope when active project changes mid-request", async () => {
    const projectA = {
      id: "proj-a",
      name: "A",
      icon: "◈",
      description: "",
      instructions: "",
      read_paths: ["/A/**"],
      write_paths: ["/A/**"],
      outputPath: "A",
      model: DEFAULT_MODEL,
      rag: { embed_model: "gemini-embedding-2", dims: 2, chunk_words: 400, top_k: 5, min_similarity: 0.5 },
      files: [],
      attachedFiles: [],
    };
    const projectB = { ...projectA, id: "proj-b", name: "B", read_paths: ["/B/**"] };

    const svc = new AppServices({
      adapter: { read: vi.fn(), write: vi.fn(), exists: vi.fn(), list: vi.fn() } as any,
      opencodeClient: { configured: true, chat: vi.fn() } as any,
      geminiBalancer: { hasKeys: false, embed: vi.fn(), keyCount: 0 } as any,
      tracer: { start: vi.fn(), finish: vi.fn(), abort: vi.fn(), addChunk: vi.fn() } as any,
      vectorStore: { count: 0, allChunks: [] } as any,
      vectorStores: new Map(),
      projectStore: {
        loadThreadData: vi.fn().mockResolvedValue(null),
        patchThreadData: vi.fn(),
      } as any,
      kgEdgeStore: { count: 0, getAllEdges: vi.fn().mockReturnValue([]), snapshot: vi.fn() } as any,
      chainStore: { load: vi.fn().mockResolvedValue(null) } as any,
      noteWriter: {} as any,
      settings: { llmProvider: "anthropic", llmModel: DEFAULT_MODEL } as any,
      agent: null,
      activeFolder: null,
      activeProject: projectA,
      activeProjectContext: { project: projectA } as any,
      activeThreadId: "thread-1",
      skillContext: null,
      getSkills: vi.fn(),
      setSkillContext: vi.fn(),
    });
    svc.activeIndexSnapshot = { status: "unavailable", projectId: "proj-a" };

    vi.mocked(executeTurn).mockImplementation(async (deps) => {
      svc.activeProject = projectB;
      svc.activeThreadId = "thread-2";
      expect(deps.projectContext?.project?.id).toBe("proj-a");
      return { content: "ok", usage: { prompt: 1, completion: 1 }, ragContext: "" };
    });

    const orch = new ChatOrchestrator(svc);
    await orch.handleMessage("hello world", undefined, undefined);
  });
});
