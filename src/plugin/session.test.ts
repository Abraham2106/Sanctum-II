import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginSession } from "./session";
import type { PluginHost } from "./plugin-host";
import type { Project } from "../projects/types";

const saveProject = vi.fn().mockResolvedValue(undefined);
const loadProject = vi.fn();
const projectExists = vi.fn().mockResolvedValue(true);
const loadMemory = vi.fn().mockResolvedValue([]);

function makeHost(project: Project): PluginHost {
  const services: any = {
    activeProject: null,
    activeProjectContext: null,
    activeThreadId: "t1",
    settings: { projectsEnabled: true, activeProjectId: project.id, projectReindexOnOpen: false },
    refreshEmbeddingForProject: vi.fn(),
    embedder: { hasKeys: false, embed: vi.fn() },
    indexService: null,
    activeIndexSnapshot: null,
  };
  return {
    app: { metadataCache: { resolvedLinks: {} } } as any,
    adapter: {
      exists: vi.fn().mockResolvedValue(false),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
      read: vi.fn(),
      write: vi.fn(),
      mkdir: vi.fn(),
    },
    settings: services.settings,
    services,
    agent: null,
    vectorStore: { count: 0, allChunks: [], load: vi.fn(), save: vi.fn() } as any,
    kgEdgeStore: { load: vi.fn(), save: vi.fn(), count: 0, getAllEdges: vi.fn().mockReturnValue([]) } as any,
    vectorStores: new Map(),
    kgEdgeStores: new Map(),
    activeFolder: null,
    noteWriter: {} as any,
    tracer: {} as any,
    opencodeClient: {} as any,
    geminiBalancer: { hasKeys: false } as any,
    projectStore: { loadProject, saveProject, projectExists, loadMemory } as any,
    saveSettings: vi.fn(),
    syncServices: vi.fn(),
    refreshChatViews: vi.fn(),
    refreshKgViews: vi.fn(),
    generateThreadId: () => "thread_new",
    notice: vi.fn(),
  };
}

describe("PluginSession (DEC-0022 open project permissions)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not widen read_paths or fill empty read_paths on open", async () => {
    const project: Project = {
      id: "p1",
      name: "P1",
      icon: "◈",
      description: "",
      instructions: "",
      read_paths: [],
      write_paths: ["/Projects/p1/**"],
      outputPath: "Projects/p1",
      model: "test",
      rag: { embed_model: "gemini-embedding-2", dims: 768, chunk_words: 400, top_k: 5, min_similarity: 0.5 },
      files: [],
      attachedFiles: [],
    };
    loadProject.mockResolvedValue({ ...project, read_paths: [], write_paths: [...project.write_paths] });
    const host = makeHost(project);
    const session = new PluginSession(host);
    vi.spyOn(session.indexService, "loadProjectIndex").mockResolvedValue({
      snapshot: { status: "unavailable", projectId: "p1" },
      vectorStore: host.vectorStore,
      kgEdgeStore: host.kgEdgeStore,
    });
    await session.setActiveProject("p1", false);
    expect(saveProject).not.toHaveBeenCalled();
    expect(host.services.activeProject?.read_paths).toEqual([]);
  });
});
