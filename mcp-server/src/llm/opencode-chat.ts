import { log } from "../mcp/logger.js"

const MODEL = "deepseek-v4-flash"

export interface ChatResult {
  content: string
  usage: { prompt: number; completion: number }
}

export async function opencodeChat(
  systemPrompt: string,
  userPrompt: string,
  baseUrl: string,
  apiKey: string,
): Promise<ChatResult> {
  if (!apiKey) {
    throw new Error("OPENCODE_GO_API_KEY no configurada")
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`
  const body = {
    model: MODEL,
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ],
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "sin cuerpo")
    throw new Error(`OpenCode API error [${response.status}] — ${text.slice(0, 300)}`)
  }

  const data = await response.json()
  if (!data.choices?.[0]?.message) {
    throw new Error(`Respuesta sin choices: ${JSON.stringify(data).slice(0, 200)}`)
  }

  const content = data.choices[0].message.content ?? ""
  log.debug("opencode chat ok", {
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  })

  return {
    content,
    usage: {
      prompt: data.usage?.prompt_tokens ?? 0,
      completion: data.usage?.completion_tokens ?? 0,
    },
  }
}
