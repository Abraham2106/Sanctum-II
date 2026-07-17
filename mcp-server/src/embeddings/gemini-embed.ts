import { log } from "../mcp/logger.js"

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
const PRIORITY_MODELS = ["gemini-embedding-2", "gemini-embedding-001"]
const OUTPUT_DIMS = 768

async function callEmbed(key: string, model: string, text: string): Promise<number[]> {
  const url = `${GEMINI_BASE}/${model}:embedContent`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: OUTPUT_DIMS,
    }),
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

export async function embedText(text: string, apiKey: string): Promise<number[]> {
  // Keep the complete query. In QUBO/Ising validation, a suffix may contain a
  // closing LaTeX delimiter, a normalization factor or a numbered equation.
  const truncated = text
  let lastError: Error | null = null

  for (const model of PRIORITY_MODELS) {
    try {
      const result = await callEmbed(apiKey, model, truncated)
      log.debug("gemini embed ok", { model, dims: result.length })
      return result
    } catch (err) {
      const status = (err as any)?.status
      lastError = err instanceof Error ? err : new Error(String(err))
      if (status === 404 || status === 400) {
        log.warn("gemini model no disponible, saltando", { model, status })
        continue
      }
      throw lastError
    }
  }
  throw lastError ?? new Error("Todos los modelos de Gemini fallaron")
}
