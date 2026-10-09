import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectIndexService } from "./index-service";

vi.mock("../projects/index-generations", () => ({
  markIndexStale: vi.fn().mockResolvedValue(undefined),
  loadIndexGenerationSnapshot: vi.fn().mockResolvedValue({ status: "unavailable", projectId: "p1" }),
  loadGenerationVectorStore: vi.fn(),
  getCachedIndexSnapshot: vi.fn(),
}));

const indexProject = vi.fn();
vi.mock("../projects/indexer", () => ({
  indexProject: (...args: unknown[]) => indexProject(...args),
}));

import { markIndexStale } from "../projects/index-generations";

describe("ProjectIndexService stale batching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks stale on vault events without calling indexProject", async () => {
    const adapter = {
      read: vi.fn(),
      write: vi.fn(),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn(),
    };
    const svc = new ProjectIndexService(adapter as any);
    svc.onVaultNoteEvent("p1");
    svc.onVaultNoteEvent("p1");
    await vi.advanceTimersByTimeAsync(500);
    expect(markIndexStale).toHaveBeenCalledTimes(1);
    expect(markIndexStale).toHaveBeenCalledWith(adapter, "p1");
    expect(indexProject).not.toHaveBeenCalled();
  });
});
