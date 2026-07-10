import { requestUrl } from "obsidian";

const MODEL = "deepseek-v4-flash";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenCodeClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    injectedContext?: string
  ): Promise<{ content: string; usage: { prompt: number; completion: number } }>;
  async chat(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<{ content: string; usage: { prompt: number; completion: number } }>;
  async chat(
    arg1: string | { role: "system" | "user" | "assistant"; content: string }[],
    arg2?: string,
    arg3?: string,
  ): Promise<{ content: string; usage: { prompt: number; completion: number } }> {
    if (!this.configured) {
      throw new Error("OPENCODE_GO_API_KEY no configurada");
    }

    let messages: { role: "system" | "user" | "assistant"; content: string }[];

    if (typeof arg1 === "string") {
      // Legacy mode: systemPrompt, userPrompt, injectedContext
      const userContent = arg3
        ? `${arg2}\n\nContexto del vault:\n${arg3}`
        : arg2 || "";
      messages = [
        { role: "system" as const, content: arg1 },
        { role: "user" as const, content: userContent },
      ];
    } else {
      // Messages array mode
      messages = arg1;
    }

    const url = `${this.baseUrl}/chat/completions`;
    const body = { model: MODEL, messages };
    const response = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status !== 200) {
      throw new Error(
        `OpenCode API error [${response.status}] — ${response.text.slice(0, 300)}`
      );
    }

    const data = response.json;
    if (!data.choices?.[0]?.message) {
      throw new Error(`Respuesta sin choices: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const content = data.choices[0].message.content;
    if (content && (content.includes("does not support") || content.startsWith("Cannot read"))) {
      console.warn("Sanctum: el modelo devolvió un mensaje de error:", content);
    }

    return {
      content: content || "",
      usage: {
        prompt: data.usage?.prompt_tokens || 0,
        completion: data.usage?.completion_tokens || 0,
      },
    };
  }
}
