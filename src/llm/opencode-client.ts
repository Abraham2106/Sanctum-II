import { requestUrl } from "obsidian";
import {
  buildAnthropicWire,
  buildOpenAiWire,
  parseAnthropicWire,
  parseOpenAiWire,
  resolveChatModel,
  type ChatMessage,
  type LlmProvider,
} from "./chat-wire";

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
  private provider: LlmProvider;
  private model: string;
  private anthropicApiKey: string;
  private anthropicBaseUrl: string;

  constructor(baseUrl: string, apiKey: string, opts?: OpenCodeClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.provider = opts?.provider ?? "openai";
    this.model = resolveChatModel(opts?.model);
    this.anthropicApiKey = opts?.anthropicApiKey ?? "";
    this.anthropicBaseUrl = (opts?.anthropicBaseUrl ?? DEFAULT_ANTHROPIC_BASE).replace(
      /\/+$/,
      "",
    );
  }

  get configured(): boolean {
    if (this.provider === "anthropic") {
      return this.anthropicApiKey.length > 0;
    }
    return this.apiKey.length > 0;
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    injectedContext?: string
  ): Promise<{ content: string; usage: { prompt: number; completion: number } }>;
  async chat(messages: ChatMessage[]): Promise<{ content: string; usage: { prompt: number; completion: number } }>;
  async chat(
    arg1: string | ChatMessage[],
    arg2?: string,
    arg3?: string,
  ): Promise<{ content: string; usage: { prompt: number; completion: number } }> {
    if (!this.configured) {
      throw new Error("OPENCODE_GO_API_KEY no configurada");
    }

    let messages: ChatMessage[];

    if (typeof arg1 === "string") {
      const userContent = arg3
        ? `${arg2}\n\nContexto del vault:\n${arg3}`
        : arg2 || "";
      messages = [
        { role: "system", content: arg1 },
        { role: "user", content: userContent },
      ];
    } else {
      messages = arg1;
    }

    const wire =
      this.provider === "anthropic"
        ? buildAnthropicWire(
            this.anthropicBaseUrl,
            this.anthropicApiKey,
            this.model,
            messages,
          )
        : buildOpenAiWire(this.baseUrl, this.apiKey, this.model, messages);

    const response = await requestUrl({
      url: wire.url,
      method: wire.method,
      contentType: "application/json",
      headers: wire.headers,
      body: wire.body,
    });

    if (response.status !== 200) {
      throw new Error(
        `OpenCode API error [${response.status}] — ${response.text.slice(0, 300)}`
      );
    }

    const parsed =
      this.provider === "anthropic"
        ? parseAnthropicWire(response.json)
        : parseOpenAiWire(response.json);

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
