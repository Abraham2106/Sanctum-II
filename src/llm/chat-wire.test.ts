import { describe, expect, it } from "vitest";
import {
  buildAnthropicWire,
  buildOpenAiWire,
  parseAnthropicWire,
  parseOpenAiWire,
  resolveChatModel,
} from "./chat-wire";
import { DEFAULT_MODEL } from "../constants";

describe("chat-wire openai", () => {
  it("builds chat/completions without appending /v1", () => {
    const wire = buildOpenAiWire(
      "https://api.opencode.ai",
      "sk-test",
      DEFAULT_MODEL,
      [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    );
    expect(wire.url).toBe("https://api.opencode.ai/chat/completions");
    expect(wire.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(wire.body);
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.messages).toHaveLength(2);
  });

  it("parses choices and token usage", () => {
    const parsed = parseOpenAiWire({
      choices: [{ message: { content: "hello" } }],
      usage: { prompt_tokens: 3, completion_tokens: 5 },
    });
    expect(parsed.content).toBe("hello");
    expect(parsed.usage).toEqual({ prompt: 3, completion: 5 });
  });
});

describe("chat-wire anthropic", () => {
  it("builds /v1/messages with max_tokens 4096 and system split", () => {
    const wire = buildAnthropicWire(
      "https://api.anthropic.com",
      "ant-key",
      "claude-3-5-sonnet-20241022",
      [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "ping" },
      ],
    );
    expect(wire.url).toBe("https://api.anthropic.com/v1/messages");
    expect(wire.headers["x-api-key"]).toBe("ant-key");
    expect(wire.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(wire.body);
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe("Be helpful");
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
  });

  it("parses first text block and maps token fields", () => {
    const parsed = parseAnthropicWire({
      content: [{ type: "text", text: "pong" }],
      usage: { input_tokens: 11, output_tokens: 7 },
    });
    expect(parsed.content).toBe("pong");
    expect(parsed.usage).toEqual({ prompt: 11, completion: 7 });
  });
});

describe("resolveChatModel", () => {
  it("uses DEFAULT_MODEL when model is empty", () => {
    expect(resolveChatModel("")).toBe(DEFAULT_MODEL);
    expect(resolveChatModel(undefined)).toBe(DEFAULT_MODEL);
  });

  it("keeps explicit model string", () => {
    expect(resolveChatModel("claude-3-5-sonnet-20241022")).toBe(
      "claude-3-5-sonnet-20241022",
    );
  });
});
