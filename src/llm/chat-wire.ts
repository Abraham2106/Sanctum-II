// DEC-0004: dos cables de chat, sin SDK de Cursor en el plugin
// ponytail: Cursor no es chat completions. Techo: este turno no llama modelos de Cursor. Subir cuando una hoja solo-MCP use @cursor/sdk y devuelva el texto final.

import { DEFAULT_MODEL } from "../constants";

export type LlmProvider = "openai" | "anthropic";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface WireRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface ChatUsage {
  prompt: number;
  completion: number;
}

export interface ParsedChat {
  content: string;
  usage: ChatUsage;
}

export function resolveChatModel(model: string | undefined): string {
  const trimmed = (model ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_MODEL;
}

export function buildOpenAiWire(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): WireRequest {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  };
}

export function parseOpenAiWire(data: unknown): ParsedChat {
  const d = data as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!d.choices?.[0]?.message) {
    throw new Error(`Respuesta sin choices: ${JSON.stringify(data).slice(0, 200)}`);
  }
  const content = d.choices[0].message.content ?? "";
  return {
    content,
    usage: {
      prompt: d.usage?.prompt_tokens ?? 0,
      completion: d.usage?.completion_tokens ?? 0,
    },
  };
}

export function buildAnthropicWire(
  anthropicBaseUrl: string,
  anthropicApiKey: string,
  model: string,
  messages: ChatMessage[],
): WireRequest {
  const url = `${anthropicBaseUrl.replace(/\/+$/, "")}/v1/messages`;
  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content);
  const apiMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: apiMessages,
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }

  return {
    url,
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

export function parseAnthropicWire(data: unknown): ParsedChat {
  const d = data as {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const block = d.content?.find((c) => c.type === "text") ?? d.content?.[0];
  const content = block?.text ?? "";
  return {
    content,
    usage: {
      prompt: d.usage?.input_tokens ?? 0,
      completion: d.usage?.output_tokens ?? 0,
    },
  };
}
