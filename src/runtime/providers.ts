/**
 * DEC-0022: portable chat provider resolution and transports (no Obsidian import).
 */

import type { CallOptions } from "./ports";
import {
  buildAnthropicWire,
  buildOpenAiWire,
  parseAnthropicWire,
  parseOpenAiWire,
  resolveChatModel,
  type ChatMessage,
  type LlmProvider,
  type ParsedChat,
  type WireRequest,
} from "../llm/chat-wire";

export type SupportedChatProvider = LlmProvider;

export interface GlobalChatConfig {
  provider?: string;
  model?: string;
}

export interface ChatCredentials {
  openaiBaseUrl: string;
  openaiApiKey: string;
  anthropicBaseUrl: string;
  anthropicApiKey: string;
}

export interface ResolvedChatCall {
  provider: SupportedChatProvider;
  model: string;
  signal?: AbortSignal;
}

export class UnsupportedProviderError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`Proveedor LLM no soportado: ${provider}`);
    this.name = "UnsupportedProviderError";
    this.provider = provider;
  }
}

/** DEC-0022: explicit provider only; never infer from model name. */
export function requireChatProvider(
  explicit?: string,
  globalDefault?: string,
): SupportedChatProvider {
  const raw = (explicit ?? globalDefault ?? "").trim();
  if (raw.length === 0) {
    return "openai";
  }
  const normalized = raw.toLowerCase();
  if (normalized === "openai" || normalized === "anthropic") {
    return normalized;
  }
  throw new UnsupportedProviderError(raw);
}

/** DEC-0022: agent > project > global; per-call model wins when set. */
export function resolveChatModelPrecedence(
  callModel?: string,
  agentModel?: string,
  projectModel?: string,
  globalModel?: string,
): string {
  const layers = [callModel, agentModel, projectModel, globalModel];
  for (const layer of layers) {
    const trimmed = layer?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return resolveChatModel(undefined);
}

export function resolveChatCall(layers: {
  call?: CallOptions;
  agentModel?: string;
  projectModel?: string;
  global?: GlobalChatConfig;
}): ResolvedChatCall {
  const model = resolveChatModelPrecedence(
    layers.call?.model,
    layers.agentModel,
    layers.projectModel,
    layers.global?.model,
  );
  const provider = requireChatProvider(layers.call?.provider, layers.global?.provider);
  return {
    provider,
    model: resolveChatModel(model),
    signal: layers.call?.signal,
  };
}

export function buildChatWire(
  resolved: ResolvedChatCall,
  creds: ChatCredentials,
  messages: ChatMessage[],
): WireRequest {
  if (resolved.provider === "anthropic") {
    return buildAnthropicWire(
      creds.anthropicBaseUrl,
      creds.anthropicApiKey,
      resolved.model,
      messages,
    );
  }
  return buildOpenAiWire(creds.openaiBaseUrl, creds.openaiApiKey, resolved.model, messages);
}

export function parseChatWireResponse(
  provider: SupportedChatProvider,
  data: unknown,
): ParsedChat {
  return provider === "anthropic" ? parseAnthropicWire(data) : parseOpenAiWire(data);
}

export function globalChatConfigFromEnv(
  env: Record<string, string | undefined>,
): GlobalChatConfig {
  return {
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
  };
}

export function chatCredentialsFromNode(
  baseUrl: string,
  apiKey: string,
  env: Record<string, string | undefined>,
): ChatCredentials {
  return {
    openaiBaseUrl: baseUrl,
    openaiApiKey: apiKey,
    anthropicBaseUrl: (env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(
      /\/+$/,
      "",
    ),
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
  };
}

export async function fetchWireRequest(
  wire: WireRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  if (signal?.aborted) {
    throw abortError(signal);
  }

  const response = await fetchImpl(wire.url, {
    method: wire.method,
    headers: wire.headers,
    body: wire.body,
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "sin cuerpo");
    throw new Error(`OpenCode API error [${response.status}] — ${text.slice(0, 300)}`);
  }

  return response.json();
}

export interface ObsidianRequestUrlResponse {
  status: number;
  text: string;
  json: unknown;
}

export type RequestUrlFn = (req: {
  url: string;
  method: string;
  contentType?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<ObsidianRequestUrlResponse>;

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  return new DOMException("Aborted", "AbortError");
}

/**
 * DEC-0022: Obsidian requestUrl cannot abort in flight; reject when already aborted
 * and discard late responses after logical cancel (no unhandled rejection).
 */
export async function requestUrlWithLogicalCancel(
  requestUrl: RequestUrlFn,
  wire: WireRequest,
  signal?: AbortSignal,
): Promise<ObsidianRequestUrlResponse> {
  if (signal?.aborted) {
    throw abortError(signal);
  }

  let logicallyAborted = false;
  const onAbort = () => {
    logicallyAborted = true;
  };

  if (signal) {
    signal.addEventListener("abort", onAbort);
  }

  try {
    const response = await requestUrl({
      url: wire.url,
      method: wire.method,
      contentType: "application/json",
      headers: wire.headers,
      body: wire.body,
    });

    if (logicallyAborted || signal?.aborted) {
      throw abortError(signal);
    }

    return response;
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

export function isChatConfigured(
  resolved: ResolvedChatCall,
  creds: ChatCredentials,
): boolean {
  if (resolved.provider === "anthropic") {
    return creds.anthropicApiKey.trim().length > 0;
  }
  return creds.openaiApiKey.trim().length > 0;
}
