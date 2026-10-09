import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL } from "../constants";

const requestUrl = vi.fn();

vi.mock("obsidian", () => ({
  requestUrl: (...args: unknown[]) => requestUrl(...args),
}));

import { OpenCodeClient } from "./opencode-client";

describe("OpenCodeClient (DEC-0022)", () => {
  afterEach(() => {
    requestUrl.mockReset();
  });

  function okResponse(content = "hi") {
    requestUrl.mockResolvedValue({
      status: 200,
      text: "{}",
      json: {
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      },
    });
  }

  it("preserves default provider/model when per-call overrides differ", async () => {
    requestUrl
      .mockResolvedValueOnce({
        status: 200,
        text: "{}",
        json: {
          choices: [{ message: { content: "a" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        text: "{}",
        json: {
          choices: [{ message: { content: "b" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
      });
    const client = new OpenCodeClient("https://api.example", "key", {
      provider: "openai",
      model: "default-model",
    });

    const first = client.chat(
      [{ role: "user", content: "one" }],
      { model: "override-a", provider: "openai" },
    );
    const second = client.chat(
      [{ role: "user", content: "two" }],
      { model: "override-b", provider: "openai" },
    );
    await Promise.all([first, second]);

    expect(client.provider).toBe("openai");
    expect(client.model).toBe("default-model");
    const bodies = requestUrl.mock.calls.map((call) =>
      JSON.parse((call[0] as { body: string }).body),
    );
    expect(bodies[0].model).toBe("override-a");
    expect(bodies[1].model).toBe("override-b");
  });

  it("supports system/user/context overload with call options", async () => {
    okResponse("answer");
    const client = new OpenCodeClient("https://api.example", "key", {
      model: DEFAULT_MODEL,
    });
    const result = await client.chat("sys", "user", "ctx", {
      model: "per-call",
      provider: "openai",
    });
    expect(result.content).toBe("answer");
    const body = JSON.parse((requestUrl.mock.calls[0][0] as { body: string }).body);
    expect(body.model).toBe("per-call");
    expect(body.messages[1].content).toContain("Contexto del vault");
  });

  it("chatMessages uses anthropic wire when provider override is anthropic", async () => {
    requestUrl.mockResolvedValue({
      status: 200,
      text: "{}",
      json: {
        content: [{ type: "text", text: "anth" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    const client = new OpenCodeClient("https://api.example", "openai-key", {
      provider: "openai",
      anthropicApiKey: "ant-key",
      anthropicBaseUrl: "https://api.anthropic.com",
    });
    await client.chatMessages([{ role: "user", content: "ping" }], {
      provider: "anthropic",
      model: "claude-test",
    });
    const req = requestUrl.mock.calls[0][0] as { url: string; headers: Record<string, string> };
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("ant-key");
  });
});
