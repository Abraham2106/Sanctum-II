import { log } from "../mcp/logger.js"
import type { CallOptions } from "../../../src/runtime/ports.js"
import {
  buildChatWire,
  chatCredentialsFromNode,
  fetchWireRequest,
  globalChatConfigFromEnv,
  isChatConfigured,
  parseChatWireResponse,
  resolveChatCall,
} from "../../../src/runtime/providers.js"

export interface ChatResult {
  content: string
  usage: { prompt: number; completion: number }
}

export async function opencodeChat(
  systemPrompt: string,
  userPrompt: string,
  baseUrl: string,
  apiKey: string,
  callOptions?: CallOptions,
): Promise<ChatResult> {
  const env = process.env
  const global = globalChatConfigFromEnv(env)
  const resolved = resolveChatCall({ call: callOptions, global })
  const creds = chatCredentialsFromNode(baseUrl, apiKey, env)

  if (!isChatConfigured(resolved, creds)) {
    if (resolved.provider === "anthropic") {
      throw new Error("ANTHROPIC_API_KEY no configurada")
    }
    throw new Error("OPENCODE_GO_API_KEY no configurada")
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ]

  const wire = buildChatWire(resolved, creds, messages)
  const data = await fetchWireRequest(wire, resolved.signal)
  const parsed = parseChatWireResponse(resolved.provider, data)

  log.debug("opencode chat ok", {
    provider: resolved.provider,
    model: resolved.model,
    promptTokens: parsed.usage.prompt,
    completionTokens: parsed.usage.completion,
  })

  return parsed
}
