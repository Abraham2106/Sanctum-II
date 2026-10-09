// DEC-0019: Discord conversa; Grok solo si hay XAI_API_KEY
// ponytail: chat completions es legacy; subir a /v1/responses cuando el cable lo tenga.

import { buildOpenAiWire, resolveChatModel } from "../llm/chat-wire";

export type DiscordChatTarget = {
  baseUrl: string;
  apiKey: string;
  model: string;
  via: "grok" | "opencode";
};

const DISCORD_CHANNEL_ID = /^\d+$/;

function assertDiscordChannelId(channelId: string): void {
  if (!DISCORD_CHANNEL_ID.test(channelId)) {
    throw new Error("invalid Discord channel id");
  }
}

export function resolveDiscordChat(env: NodeJS.ProcessEnv): DiscordChatTarget {
  const xaiKey = (env.XAI_API_KEY ?? "").trim();
  if (xaiKey.length > 0) {
    const model = (env.XAI_MODEL ?? "").trim() || "grok-4.7";
    return {
      baseUrl: "https://api.x.ai/v1",
      apiKey: xaiKey,
      model,
      via: "grok",
    };
  }

  const opencodeKey = (env.OPENCODE_GO_API_KEY ?? "").trim();
  if (opencodeKey.length > 0) {
    const baseUrl = (env.OPENCODE_GO_BASE_URL ?? "").trim();
    if (baseUrl.length === 0) {
      throw new Error("OPENCODE_GO_BASE_URL");
    }
    return {
      baseUrl,
      apiKey: opencodeKey,
      model: resolveChatModel(env.LLM_MODEL),
      via: "opencode",
    };
  }

  throw new Error("XAI_API_KEY o OPENCODE_GO_API_KEY");
}

export function buildDiscordChatWire(
  target: DiscordChatTarget,
  system: string,
  user: string,
) {
  return buildOpenAiWire(target.baseUrl, target.apiKey, target.model, [
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}

export function buildDiscordSend(
  channelId: string,
  content: string,
  token: string,
) {
  assertDiscordChannelId(channelId);
  return {
    url: `https://discord.com/api/v10/channels/${channelId}/messages`,
    method: "POST" as const,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: content.slice(0, 1900) }),
  };
}

export function buildDiscordHistory(
  channelId: string,
  token: string,
  limit = 50,
) {
  assertDiscordChannelId(channelId);
  let n = limit;
  if (!Number.isFinite(n)) {
    n = 50;
  }
  n = Math.min(100, Math.max(1, Math.floor(n)));
  return {
    url: `https://discord.com/api/v10/channels/${channelId}/messages?limit=${n}`,
    method: "GET" as const,
    headers: {
      Authorization: `Bot ${token}`,
    },
  };
}
