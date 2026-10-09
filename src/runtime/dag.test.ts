import { describe, expect, it, vi } from "vitest";
import {
  DagValidationError,
  executeDag,
  formatTerminalFinalOutput,
  stableTopologicalOrder,
  validateDag,
} from "./dag";

describe("validateDag / stableTopologicalOrder (DEC-0022)", () => {
  it("rejects duplicate node ids", () => {
    expect(() =>
      validateDag({
        nodes: [{ id: "a" }, { id: "a" }],
        edges: [],
      }),
    ).toThrow(DagValidationError);
  });

  it("rejects missing edge endpoints", () => {
    expect(() =>
      validateDag({
        nodes: [{ id: "a" }],
        edges: [{ from: "a", to: "missing" }],
      }),
    ).toThrow(/inexistente/);
  });

  it("rejects duplicate edges (same from/to)", () => {
    expect(() =>
      validateDag({
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "b" },
        ],
      }),
    ).toThrow(/duplicada/);
  });

  it("rejects cycles before execution", () => {
    expect(() =>
      validateDag({
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      }),
    ).toThrow(/Ciclo/);
  });

  it("uses stable order for disconnected nodes (declaration order)", () => {
    const order = stableTopologicalOrder(
      [{ id: "b" }, { id: "a" }, { id: "c" }],
      [],
    );
    expect(order).toEqual(["b", "a", "c"]);
  });
});

describe("executeDag (DEC-0022)", () => {
  const base = {
    userMessage: "USER",
    projectId: "proj-1",
    provenance: "test.dag",
  };

  it("disconnected nodes only see original message, not sibling outputs", async () => {
    const seen: Record<string, string> = {};
    await executeDag({
      graph: { nodes: [{ id: "x" }, { id: "y" }], edges: [] },
      ...base,
      runNode: async (ctx) => {
        seen[ctx.nodeId] = ctx.userMessage;
        return { output: ctx.nodeId.toUpperCase(), usage: { prompt: 1, completion: 1 } };
      },
    });
    expect(seen.x).toBe("USER");
    expect(seen.y).toBe("USER");
    expect(seen.x).not.toContain("Y");
    expect(seen.y).not.toContain("X");
  });

  it("branch merges only direct predecessor outputs", async () => {
    const inputs: string[] = [];
    await executeDag({
      graph: {
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        edges: [
          { from: "a", to: "c" },
          { from: "b", to: "c" },
        ],
      },
      ...base,
      runNode: async (ctx) => {
        inputs.push(`${ctx.nodeId}:${ctx.predecessorOutputs.map((p) => p.nodeId).join(",")}`);
        return { output: ctx.nodeId, usage: { prompt: 0, completion: 0 } };
      },
    });
    expect(inputs).toContain("a:");
    expect(inputs).toContain("b:");
    expect(inputs).toContain("c:a,b");
  });

  it("multiple terminals produce ordered sections", async () => {
    const result = await executeDag({
      graph: {
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [],
      },
      ...base,
      runNode: async (ctx) => ({
        output: `out-${ctx.nodeId}`,
        usage: { prompt: 0, completion: 0 },
      }),
    });
    expect(result.terminalOutputs).toHaveLength(2);
    expect(result.finalOutput).toBe(formatTerminalFinalOutput(result.terminalOutputs));
    expect(result.finalOutput).toContain("## a");
    expect(result.finalOutput).toContain("## b");
  });

  it("single terminal returns raw output as finalOutput", async () => {
    const result = await executeDag({
      graph: { nodes: [{ id: "only" }], edges: [] },
      ...base,
      runNode: async () => ({
        output: "solo",
        usage: { prompt: 0, completion: 0 },
      }),
    });
    expect(result.finalOutput).toBe("solo");
  });

  it("node failure keeps partial results with failed status", async () => {
    const result = await executeDag({
      graph: {
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [{ from: "a", to: "b" }],
      },
      ...base,
      runNode: async (ctx) => {
        if (ctx.nodeId === "b") {
          throw new Error("boom");
        }
        return { output: "ok-a", usage: { prompt: 0, completion: 0 } };
      },
    });
    expect(result.status).toBe("failed");
    expect(result.results).toHaveLength(1);
    expect(result.projectId).toBe("proj-1");
    expect(result.provenance).toBe("test.dag");
    expect(result.error).toMatch(/boom/);
  });

  it("cancellation stops with cancelled status", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await executeDag({
      graph: { nodes: [{ id: "a" }], edges: [] },
      ...base,
      signal: controller.signal,
      runNode: async () => ({ output: "nope", usage: { prompt: 0, completion: 0 } }),
    });
    expect(result.status).toBe("cancelled");
    expect(result.results).toHaveLength(0);
  });

  it("aborts mid-run when signal fires", async () => {
    const controller = new AbortController();
    const runNode = vi.fn(async (ctx: { nodeId: string }) => {
      if (ctx.nodeId === "a") {
        controller.abort();
      }
      return { output: ctx.nodeId, usage: { prompt: 0, completion: 0 } };
    });
    const result = await executeDag({
      graph: {
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [{ from: "a", to: "b" }],
      },
      ...base,
      signal: controller.signal,
      runNode,
    });
    expect(result.status).toBe("cancelled");
    expect(runNode).toHaveBeenCalledTimes(1);
  });
});
