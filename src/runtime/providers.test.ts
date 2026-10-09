import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL } from "../constants";
import {
  fetchWireRequest,
  requireChatProvider,
  requestUrlWithLogicalCancel,
  resolveChatCall,
  resolveChatModelPrecedence,
  UnsupportedProviderError,
} from "./providers";
import { buildOpenAiWire } from "../llm/chat-wire";

describe("providers (DEC-0022)", () => {
  it("rejects unsupported provider without coercion", () => {
    expect(() => requireChatProvider("grok")).toThrow(UnsupportedProviderError);
    expect(() => requireChatProvider("cursor")).toThrow(UnsupportedProviderError);
  });

  it("accepts explicit openai and anthropic", () => {
    expect(requireChatProvider("openai")).toBe("openai");
    expect(requireChatProvider("Anthropic")).toBe("anthropic");
  });

  it("resolves model agent > project > global", () => {
    expect(
      resolveChatModelPrecedence(undefined, "agent-m", "project-m", "global-m"),
    ).toBe("agent-m");
    expect(resolveChatModelPrecedence(undefined, "", "project-m", "global-m")).toBe(
      "project-m",
    );
    expect(resolveChatModelPrecedence(undefined, "", "", "global-m")).toBe("global-m");
    expect(resolveChatModelPrecedence(undefined, "", "", "")).toBe(DEFAULT_MODEL);
  });

  it("per-call model overrides agent/project/global", () => {
    const resolved = resolveChatCall({
      call: { model: "call-m" },
      agentModel: "agent-m",
      projectModel: "project-m",
      global: { model: "global-m" },
    });
    expect(resolved.model).toBe("call-m");
  });

  it("propagates AbortSignal from call options", () => {
    const controller = new AbortController();
    const resolved = resolveChatCall({
      call: { signal: controller.signal },
      global: { provider: "openai", model: DEFAULT_MODEL },
    });
    expect(resolved.signal).toBe(controller.signal);
  });

  it("fetchWireRequest forwards AbortSignal to fetch", async () => {
    const wire = buildOpenAiWire("https://api.example", "k", DEFAULT_MODEL, [
      { role: "user", content: "hi" },
    ]);
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    await expect(
      fetchWireRequest(wire, controller.signal, fetchImpl),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetchWireRequest aborts in-flight fetch", async () => {
    const wire = buildOpenAiWire("https://api.example", "k", DEFAULT_MODEL, [
      { role: "user", content: "hi" },
    ]);
    const controller = new AbortController();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;
    const pending = fetchWireRequest(wire, controller.signal, fetchImpl);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("requestUrlWithLogicalCancel rejects when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const requestUrl = vi.fn();
    await expect(
      requestUrlWithLogicalCancel(
        requestUrl,
        buildOpenAiWire("https://api.example", "k", DEFAULT_MODEL, [
          { role: "user", content: "x" },
        ]),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("requestUrlWithLogicalCancel discards late response after abort", async () => {
    const controller = new AbortController();
    const wire = buildOpenAiWire("https://api.example", "k", DEFAULT_MODEL, [
      { role: "user", content: "x" },
    ]);
    const requestUrl = vi.fn(async () => {
      controller.abort();
      return { status: 200, text: "{}", json: { choices: [{ message: { content: "late" } }] } };
    });
    await expect(
      requestUrlWithLogicalCancel(requestUrl, wire, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("requestUrlWithLogicalCancel removes abort listener", async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const wire = buildOpenAiWire("https://api.example", "k", DEFAULT_MODEL, [
      { role: "user", content: "ok" },
    ]);
    const requestUrl = vi.fn(async () => ({
      status: 200,
      text: "{}",
      json: { choices: [{ message: { content: "ok" } }] },
    }));
    await requestUrlWithLogicalCancel(requestUrl, wire, controller.signal);
    expect(addSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
