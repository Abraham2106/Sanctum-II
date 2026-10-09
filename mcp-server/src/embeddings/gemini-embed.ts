import { log } from "../mcp/logger.js"
import {
  embedContentJsonBody,
  MAX_TEXT_LENGTH,
  PRIORITY_MODELS,
} from "../../../src/embeddings/embed-contract.js"

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

async function callEmbed(key: string, model: string, text: string, dims?: number): Promise<number[]> {
  const url = `${GEMINI_BASE}/${model}:embedContent?key=${key}`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(embedContentJsonBody(model, text, dims)),
  })
  if (!response.ok) {
    const err = new Error(`Gemini API error [${response.status}] modelo "${model}"`)
    ;(err as any).status = response.status
    throw err
  }
  const data = await response.json()
  if (!data.embedding?.values) {
    throw new Error(`Respuesta inesperada de Gemini API: ${JSON.stringify(data).slice(0, 200)}`)
  }
  return data.embedding.values
}

export async function embedText(
  text: string,
  apiKey: string,
  model?: string,
  dims?: number,
): Promise<number[]> {
  const keys = apiKey
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
  const truncated = text.slice(0, MAX_TEXT_LENGTH)
  let lastError: Error | null = null

  const fixedModel = model?.trim()
  const models = fixedModel ? [fixedModel] : [...PRIORITY_MODELS]

  // DEC-0011: una clave Gemini en 429 no agota las demás
  for (const candidate of models) {
    for (const key of keys) {
      try {
        const result = await callEmbed(key, candidate, truncated, dims)
        log.debug("gemini embed ok", { model: candidate, dims: result.length })
        return result
      } catch (err) {
        const status = (err as any)?.status
        lastError = err instanceof Error ? err : new Error(String(err))
        if (status === 429 || status === 403) {
          continue
        }
        if (!fixedModel && (status === 404 || status === 400)) {
          log.warn("gemini model no disponible, saltando", { model: candidate, status })
          break
        }
        throw lastError
      }
    }
  }
  throw lastError ?? new Error("Todos los modelos de Gemini fallaron")
}
