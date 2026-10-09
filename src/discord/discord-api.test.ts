import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "../constants";
import {
  buildDiscordChatWire,
  buildDiscordHistory,
  buildDiscordSend,
  resolveDiscordChat,
} from "./discord-api";

describe("resolveDiscordChat + buildDiscordChatWire", () => {
  it("uses xAI Grok wire when XAI_API_KEY is set", () => {
    const target = resolveDiscordChat({ XAI_API_KEY: "xai-secret" });
    expect(target.via).toBe("grok");
    const wire = buildDiscordChatWire(target, "sys", "hi");
    expect(wire.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(wire.method).toBe("POST");
    expect(wire.headers.Authorization).toBe("Bearer xai-secret");
    const body = JSON.parse(wire.body);
    expect(body.model).toBe("grok-4.7");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });

  it("honors XAI_MODEL", () => {
    const target = resolveDiscordChat({
      XAI_API_KEY: "k",
      XAI_MODEL: "grok-custom",
    });
    const wire = buildDiscordChatWire(target, "s", "u");
    expect(JSON.parse(wire.body).model).toBe("grok-custom");
  });

  it("prefers xAI when OpenCode keys are also present", () => {
    const target = resolveDiscordChat({
      XAI_API_KEY: "xai-wins",
      OPENCODE_GO_API_KEY: "oc",
      OPENCODE_GO_BASE_URL: "https://api.opencode.ai",
    });
    expect(target.via).toBe("grok");
    const wire = buildDiscordChatWire(target, "s", "u");
    expect(wire.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(wire.headers.Authorization).toBe("Bearer xai-wins");
  });

  it("falls back to OpenCode when XAI key is missing", () => {
    const target = resolveDiscordChat({
      OPENCODE_GO_API_KEY: "oc-key",
      OPENCODE_GO_BASE_URL: "https://api.opencode.ai",
      LLM_MODEL: "my-model",
    });
    expect(target).toEqual({
      baseUrl: "https://api.opencode.ai",
      apiKey: "oc-key",
      model: "my-model",
      via: "opencode",
    });
    const wire = buildDiscordChatWire(target, "s", "u");
    expect(wire.url).toBe("https://api.opencode.ai/chat/completions");
    expect(wire.headers.Authorization).toBe("Bearer oc-key");
  });

  it("uses DEFAULT_MODEL for OpenCode when LLM_MODEL is empty", () => {
    const target = resolveDiscordChat({
      OPENCODE_GO_API_KEY: "k",
      OPENCODE_GO_BASE_URL: "https://base.example",
    });
    expect(target.model).toBe(DEFAULT_MODEL);
  });

  it("throws when no API keys", () => {
    expect(() => resolveDiscordChat({})).toThrow(
      "XAI_API_KEY o OPENCODE_GO_API_KEY",
    );
  });

  it("throws when OpenCode key without base URL", () => {
    expect(() =>
      resolveDiscordChat({ OPENCODE_GO_API_KEY: "only-key" }),
    ).toThrow("OPENCODE_GO_BASE_URL");
  });
});

describe("buildDiscordSend", () => {
  it("posts to channel messages with Bot auth and truncated content", () => {
    const long = "x".repeat(2500);
    const req = buildDiscordSend("123456789", long, "tok");
    expect(req.url).toBe(
      "https://discord.com/api/v10/channels/123456789/messages",
    );
    expect(req.method).toBe("POST");
    expect(req.headers.Authorization).toBe("Bot tok");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body!).content).toHaveLength(1900);
  });

  it("rejects non-numeric channel id", () => {
    expect(() => buildDiscordSend("abc", "hi", "t")).toThrow();
    expect(() => buildDiscordHistory("12a34", "t")).toThrow();
  });
});

describe("buildDiscordHistory", () => {
  it("GETs messages with default limit 50", () => {
    const req = buildDiscordHistory("99", "bot-token");
    expect(req.url).toBe(
      "https://discord.com/api/v10/channels/99/messages?limit=50",
    );
    expect(req.method).toBe("GET");
    expect(req.headers.Authorization).toBe("Bot bot-token");
  });

  it("clamps limit to 1..100", () => {
    expect(buildDiscordHistory("1", "t", 0).url).toContain("limit=1");
    expect(buildDiscordHistory("1", "t", 200).url).toContain("limit=100");
    expect(buildDiscordHistory("1", "t", 25).url).toContain("limit=25");
    expect(buildDiscordHistory("1", "t", Number.NaN).url).toContain("limit=50");
  });
});
