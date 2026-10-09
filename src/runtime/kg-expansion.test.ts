import { describe, expect, it } from "vitest";
import { buildEffectiveReadScope } from "./permissions";
import { authorizedExpandFromSeeds } from "./kg-expansion";

describe("authorizedExpandFromSeeds (DEC-0022)", () => {
  it("denied intermediate node cannot bridge two allowed endpoints", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**", "/Docs/**"],
      agentReadPaths: ["/**"],
    });
    const result = authorizedExpandFromSeeds({
      seedNotes: ["Research/seed.md"],
      queryEmbedding: [1, 0, 0],
      scope,
      hops: 2,
      maxNeighborsPerHop: 5,
      edges: [
        { from: "Research/seed.md", to: "Finanzas/bridge.md", weight: 1 },
        { from: "Finanzas/bridge.md", to: "Docs/target.md", weight: 1 },
      ],
      chunks: [
        {
          id: "t",
          notePath: "Docs/target.md",
          chunkText: "target",
          embedding: [1, 0, 0],
        },
      ],
    });
    expect(result.added_chunks.some((c) => c.note_path === "Docs/target.md")).toBe(false);
    expect(result.added_chunks.some((c) => c.note_path.includes("Finanzas"))).toBe(false);
  });
});
