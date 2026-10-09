import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../agents/types";
import type { TurnDeps } from "../orchestrator/agent-turn";
import type { Chain } from "./types";

const executeTurnMock = vi.fn();

vi.mock("../orchestrator/agent-turn", () => ({
  executeTurn: (...args: unknown[]) => executeTurnMock(...args),
}));

import { executeChain } from "./executor";

const agent: AgentDefinition = {
  id: "a1",
  name: "A",
  avatar: "",
  model: "m",
  description: "",
  triggers: [],
  tools: [],
  permissions: { read_paths: [], write_paths: [] },
  system_prompt: "sys",
};

const chain: Chain = {
  id: "c1",
  name: "C",
  invocation: "@c1",
  description: "",
  projectId: "p1",
  nodes: [{ id: "n1", agentId: "a1", x: 0, y: 0 }],
  edges: [],
  defaultForProject: false,
};

const baseDeps = {
  agent,
  opencodeClient: {} as TurnDeps["opencodeClient"],
  geminiBalancer: {} as TurnDeps["geminiBalancer"],
  vectorStore: {} as TurnDeps["vectorStore"],
  tracer: {} as TurnDeps["tracer"],
} satisfies TurnDeps;

describe("executeChain AbortSignal (T-052)", () => {
  beforeEach(() => {
    executeTurnMock.mockReset();
    executeTurnMock.mockResolvedValue({
      content: "node-out",
      usage: { prompt: 1, completion: 1 },
      ragContext: "",
    });
  });

  it("passes DAG AbortSignal into executeTurn", async () => {
    const controller = new AbortController();

    await executeChain(
      chain,
      baseDeps,
      async () => agent,
      "user message",
      undefined,
      controller.signal,
    );

    expect(executeTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
      "user message",
      false,
      undefined,
    );
  });
});
