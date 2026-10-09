import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

import { opencodeChat } from "./opencode-chat";

describe("opencodeChat (DEC-0022)", () => {
  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("keeps four-arg signature and uses env global provider", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "env-model";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });

    const result = await opencodeChat("sys", "user", "https://api.example", "key");
    expect(result.content).toBe("ok");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("env-model");
  });

  it("honors per-call provider/model overrides", async () => {
    process.env.LLM_PROVIDER = "openai";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "x" } }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    });

    await opencodeChat("s", "u", "https://api.example", "key", {
      model: "override-model",
      provider: "openai",
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("override-model");
  });

  it("throws on unsupported provider in call options", async () => {
    await expect(
      opencodeChat("s", "u", "https://base", "key", { provider: "grok" }),
    ).rejects.toThrow(/no soportado/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
