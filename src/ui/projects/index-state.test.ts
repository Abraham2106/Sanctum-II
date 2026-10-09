import { describe, expect, it } from "vitest";
import { classifyIndexUiState, indexUiStatusLabel } from "./index-state";

describe("index-state (T-043)", () => {
  it("marks stale snapshots separately from ready", () => {
    expect(
      classifyIndexUiState({
        status: "ready",
        projectId: "p1",
        stale: true,
      }),
    ).toBe("stale");
    expect(indexUiStatusLabel("rebuild_required")).toContain("Reconstrucción");
  });
});
