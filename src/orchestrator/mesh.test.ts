import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../agents/types";

const executeTurnMock = vi.fn();

vi.mock("./agent-turn", () => ({
  executeTurn: (...args: unknown[]) => executeTurnMock(...args),
}));

vi.mock("../agents/agent-loader", () => ({
  loadAgentFromVault: vi.fn(async () => ({
    id: "agent",
    name: "Agent",
    avatar: "",
    model: "test-model",
    description: "",
    triggers: [],
    tools: [],
    permissions: { read_paths: [], write_paths: [] },
    system_prompt: "sys {{rag_context}}",
  })),
  renderSystemPrompt: vi.fn((_agent: AgentDefinition, _rag: string, user: string) => user),
}));

import { runMeshWithCritic } from "./mesh";

const turnResult = {
  content: "step-out",
  usage: { prompt: 0, completion: 0 },
  ragContext: "",
};

describe("runMeshWithCritic AbortSignal (T-052)", () => {
  beforeEach(() => {
    executeTurnMock.mockReset();
    executeTurnMock.mockImplementation(async (_deps, _input, skipRag?: boolean) => {
      if (skipRag) {
        return {
          content: JSON.stringify({
            evaluation: { total_score: 85, verdict: "accept", criteria: [] },
          }),
          usage: { prompt: 0, completion: 0 },
          ragContext: "",
        };
      }
      return turnResult;
    });
  });

  it("forwards mesh run signal into executeTurn deps", async () => {
    const controller = new AbortController();
    const tracer = {
      start: vi.fn(() => "trace-1"),
      finish: vi.fn(async () => undefined),
      abort: vi.fn(),
    };
    const opencodeClient = {
      chat: vi.fn().mockResolvedValue({
        content: '{"action":"regenerate","reason":"test"}',
        usage: { prompt: 0, completion: 0 },
      }),
    };

    await runMeshWithCritic({
      userPrompt: "hello",
      vaultAdapter: { read: vi.fn(async () => "") },
      geminiBalancer: {} as never,
      vectorStore: {} as never,
      opencodeClient: opencodeClient as never,
      tracer: tracer as never,
      signal: controller.signal,
    });

    expect(executeTurnMock).toHaveBeenCalled();
    for (const [deps] of executeTurnMock.mock.calls) {
      expect(deps.signal).toBeDefined();
      expect(deps.signal?.aborted).toBe(controller.signal.aborted);
    }
  });

  it("maps aborted executeTurn to cancelled mesh status", async () => {
    const controller = new AbortController();
    controller.abort();
    executeTurnMock.mockImplementation(async (deps: { signal?: AbortSignal }) => {
      if (deps.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return turnResult;
    });

    const tracer = {
      start: vi.fn(() => "trace-2"),
      finish: vi.fn(async () => undefined),
      abort: vi.fn(),
    };

    const result = await runMeshWithCritic({
      userPrompt: "hello",
      vaultAdapter: { read: vi.fn(async () => "") },
      geminiBalancer: {} as never,
      vectorStore: {} as never,
      opencodeClient: { chat: vi.fn() } as never,
      tracer: tracer as never,
      signal: controller.signal,
    });

    expect(result.meshStatus).toBe("cancelled");
    expect(result.meshCore?.status).toBe("cancelled");
  });
});
