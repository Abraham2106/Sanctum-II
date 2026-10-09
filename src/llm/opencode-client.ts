import { requestUrl } from "obsidian";
import { resolveChatModel, type ChatMessage, type LlmProvider } from "./chat-wire";
import type { CallOptions } from "../runtime/ports";
import {
  buildChatWire,
  isChatConfigured,
  parseChatWireResponse,
  requestUrlWithLogicalCancel,
  resolveChatCall,
  type ChatCredentials,
  type ResolvedChatCall,
} from "../runtime/providers";

export interface OpenCodeClientOptions {
  provider?: LlmProvider;
  model?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
}

const DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com";

export class OpenCodeClient {
  private baseUrl: string;
  private apiKey: string;
  private defaultProvider: LlmProvider;
  private defaultModel: string;
  private anthropicApiKey: string;
  private anthropicBaseUrl: string;

  constructor(baseUrl: string, apiKey: string, opts?: OpenCodeClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.defaultProvider = opts?.provider ?? "openai";
    this.defaultModel = resolveChatModel(opts?.model);
    this.anthropicApiKey = opts?.anthropicApiKey ?? "";
    this.anthropicBaseUrl = (opts?.anthropicBaseUrl ?? DEFAULT_ANTHROPIC_BASE).replace(
      /\/+$/,
      "",
    );
  }

  get provider(): LlmProvider {
    return this.defaultProvider;
  }

  get model(): string {
    return this.defaultModel;
  }

  get configured(): boolean {
    return isChatConfigured(this.clientGlobalResolved(), this.credentials());
  }

  private credentials(): ChatCredentials {
    return {
      openaiBaseUrl: this.baseUrl,
      openaiApiKey: this.apiKey,
      anthropicBaseUrl: this.anthropicBaseUrl,
      anthropicApiKey: this.anthropicApiKey,
    };
  }

  private clientGlobalResolved(): ResolvedChatCall {
    return resolveChatCall({
      global: { provider: this.defaultProvider, model: this.defaultModel },
    });
  }

  private resolvePerCall(options?: CallOptions): ResolvedChatCall {
    return resolveChatCall({
      call: options,
      global: { provider: this.defaultProvider, model: this.defaultModel },
    });
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    injectedContext?: string,
    options?: CallOptions,
  ): Promise<{ content: string; usage: { prompt: number; completion: number } }>;
  async chat(
    messages: ChatMessage[],
    options?: CallOptions,
  ): Promise<{ content: string; usage: { prompt: number; completion: number } }>;
  async chat(
    arg1: string | ChatMessage[],
    arg2?: string | CallOptions,
    arg3?: string,
    arg4?: CallOptions,
  ): Promise<{ content: string; usage: { prompt: number; completion: number } }> {
    if (Array.isArray(arg1)) {
      const options = typeof arg2 === "object" && arg2 !== null ? arg2 : undefined;
      return this.chatMessages(arg1, options);
    }

    const userPrompt = typeof arg2 === "string" ? arg2 : "";
    const injectedContext = typeof arg3 === "string" ? arg3 : undefined;
    const options = arg4;

    const userContent = injectedContext
      ? `${userPrompt}\n\nContexto del vault:\n${injectedContext}`
      : userPrompt || "";

    const messages: ChatMessage[] = [
      { role: "system", content: arg1 },
      { role: "user", content: userContent },
    ];
    return this.chatMessages(messages, options);
  }

  async chatMessages(
    messages: ChatMessage[],
    options?: CallOptions,
  ): Promise<{ content: string; usage: { prompt: number; completion: number } }> {
    const resolved = this.resolvePerCall(options);
    const creds = this.credentials();

    if (!isChatConfigured(resolved, creds)) {
      throw new Error("OPENCODE_GO_API_KEY no configurada");
    }

    const wire = buildChatWire(resolved, creds, messages);

    const response = await requestUrlWithLogicalCancel(
      (req) =>
        requestUrl({
          url: req.url,
          method: req.method,
          contentType: req.contentType,
          headers: req.headers,
          body: req.body,
        }),
      wire,
      resolved.signal,
    );

    if (response.status !== 200) {
      throw new Error(
        `OpenCode API error [${response.status}] — ${response.text.slice(0, 300)}`,
      );
    }

    const parsed = parseChatWireResponse(resolved.provider, response.json);

    if (
      parsed.content &&
      (parsed.content.includes("does not support") ||
        parsed.content.startsWith("Cannot read"))
    ) {
      console.warn("Sanctum: el modelo devolvió un mensaje de error:", parsed.content);
    }

    return parsed;
  }
}
