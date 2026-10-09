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

  it("high-weight denied neighbor does not starve authorized neighbor", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**", "/Docs/**"],
      agentReadPaths: ["/**"],
    });
    const result = authorizedExpandFromSeeds({
      seedNotes: ["Research/seed.md"],
      queryEmbedding: [1, 0, 0],
      scope,
      hops: 1,
      maxNeighborsPerHop: 1,
      edges: [
        { from: "Research/seed.md", to: "Finanzas/denied.md", weight: 100 },
        { from: "Research/seed.md", to: "Docs/allowed.md", weight: 1 },
      ],
      chunks: [
        {
          id: "a",
          notePath: "Docs/allowed.md",
          chunkText: "allowed",
          embedding: [1, 0, 0],
        },
      ],
    });
    expect(result.added_chunks.some((c) => c.note_path === "Docs/allowed.md")).toBe(true);
    expect(result.added_chunks.some((c) => c.note_path.includes("Finanzas"))).toBe(false);
  });

  it("malformed embedding dims do not enter KG chunks", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**"],
      agentReadPaths: ["/**"],
    });
    const result = authorizedExpandFromSeeds({
      seedNotes: ["Research/seed.md"],
      queryEmbedding: [1, 0, 0],
      scope,
      hops: 1,
      maxNeighborsPerHop: 2,
      edges: [{ from: "Research/seed.md", to: "Research/neighbor.md", weight: 1 }],
      chunks: [
        {
          id: "bad",
          notePath: "Research/neighbor.md",
          chunkText: "bad dims",
          embedding: [1, 0],
        },
      ],
    });
    expect(result.added_chunks).toHaveLength(0);
  });
});
