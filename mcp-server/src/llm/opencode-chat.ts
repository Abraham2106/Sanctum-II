import { log } from "../mcp/logger.js"
import {
  buildAnthropicWire,
  buildOpenAiWire,
  parseAnthropicWire,
  parseOpenAiWire,
  resolveChatModel,
} from "../../../src/llm/chat-wire.js"

export interface ChatResult {
  content: string
  usage: { prompt: number; completion: number }
}

function readProvider(): "openai" | "anthropic" {
  const p = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase()
  return p === "anthropic" ? "anthropic" : "openai"
}

export async function opencodeChat(
  systemPrompt: string,
  userPrompt: string,
  baseUrl: string,
  apiKey: string,
): Promise<ChatResult> {
  const provider = readProvider()
  const model = resolveChatModel(process.env.LLM_MODEL)
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? ""
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ]

  if (provider === "anthropic") {
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY no configurada")
    }
  } else if (!apiKey) {
    throw new Error("OPENCODE_GO_API_KEY no configurada")
  }

  const wire =
    provider === "anthropic"
      ? buildAnthropicWire(anthropicBaseUrl, anthropicApiKey, model, messages)
      : buildOpenAiWire(baseUrl, apiKey, model, messages)

  const response = await fetch(wire.url, {
    method: wire.method,
    headers: wire.headers,
    body: wire.body,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "sin cuerpo")
    throw new Error(`OpenCode API error [${response.status}] — ${text.slice(0, 300)}`)
  }

  const data = await response.json()
  const parsed =
    provider === "anthropic" ? parseAnthropicWire(data) : parseOpenAiWire(data)

  log.debug("opencode chat ok", {
    provider,
    model,
    promptTokens: parsed.usage.prompt,
    completionTokens: parsed.usage.completion,
  })

  return parsed
}
