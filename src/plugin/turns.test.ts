import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginTurns } from "./turns";
import type { PluginHost } from "./plugin-host";

const runMeshWithCritic = vi.fn();
const writeNoteAtPath = vi.fn();

vi.mock("../orchestrator/mesh", () => ({
  runMeshWithCritic: (...args: unknown[]) => runMeshWithCritic(...args),
}));

vi.mock("../orchestrator/note-generator", () => ({
  writeNoteAtPath: (...args: unknown[]) => writeNoteAtPath(...args),
}));

describe("PluginTurns mesh write gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMeshWithCritic.mockResolvedValue({
      researcherOutput: "# Doc",
      meshStatus: "needs_review",
      criticVerdict: "needs_review",
      attempts: 2,
    });
  });

  it("does not write notes when mesh ends needs_review", async () => {
    const services: any = {
      captureRequestSnapshot: vi.fn().mockReturnValue({
        project: { outputPath: "Research", write_paths: ["/Research/**"] },
        agent: { permissions: { write_paths: ["/Research/**"] } },
        pathFilter: undefined,
        vectorStore: {},
        geminiBalancer: {},
        kgEdgeStore: {},
        kgOptions: {},
        projectContext: null,
        skillContext: null,
        projectId: "p1",
      }),
      beginMeshRequest: vi.fn().mockReturnValue(new AbortController()),
      clearMeshAbort: vi.fn(),
      effectiveWritePaths: vi.fn().mockReturnValue(["/Research/**"]),
    };
    const host: PluginHost = {
      adapter: {} as any,
      settings: {} as any,
      services,
      agent: { permissions: { write_paths: ["/Research/**"] } } as any,
      opencodeClient: {} as any,
      geminiBalancer: {} as any,
      tracer: {} as any,
      noteWriter: {} as any,
      notice: vi.fn(),
      app: {} as any,
      vectorStore: {} as any,
      kgEdgeStore: {} as any,
      vectorStores: new Map(),
      kgEdgeStores: new Map(),
      activeFolder: null,
      projectStore: {} as any,
      saveSettings: vi.fn(),
      syncServices: vi.fn(),
      refreshChatViews: vi.fn(),
      refreshKgViews: vi.fn(),
      generateThreadId: vi.fn(),
    };
    const turns = new PluginTurns(host);
    await turns.runMesh("write note about quantum");
    expect(writeNoteAtPath).not.toHaveBeenCalled();
  });
});
