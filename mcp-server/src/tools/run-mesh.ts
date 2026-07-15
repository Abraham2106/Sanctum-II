import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { loadAgentFromVault, renderSystemPrompt } from "../../../src/agents/agent-loader.js"
import { opencodeChat } from "../llm/opencode-chat.js"
import { TraceWriter } from "../observability/trace-writer.js"
import { log } from "../mcp/logger.js"

// Shared mesh module — single source of truth for types and parsing
import { parseCriticJSON } from "../../../src/shared/mesh/parse.js"
import { buildCriticInput } from "../../../src/shared/mesh/core.js"
import type { CriticEvaluation } from "../../../src/shared/mesh/types.js"

const MAX_ATTEMPTS = 3
const DEFAULT_THRESHOLD = 80
const ESCALATE_THRESHOLD = 40

function buildResearcherInput(foragerOutput: string, feedbackList: string[]): string {
  if (feedbackList.length === 0) return foragerOutput
  return `${foragerOutput}\n\n---\nFeedback del Critic para regeneración:\n${feedbackList.map(f => `- ${f}`).join("\n")}\n\nPor favor, regenera tu respuesta teniendo en cuenta todo el feedback acumulado. Especialmente mejora los criterios con puntuación más baja.`
}

export function createRunMeshTool(
  vault: VaultAdapter,
  opencodeBaseUrl: string,
  opencodeApiKey: string,
  tracer: TraceWriter,
): ToolDef {
  return {
    name: "sanctum_run_mesh",
    description:
      "Dispara el loop completo Forager → Researcher → Critic. Forager reformula el prompt y reúne contexto; Researcher produce la investigación; Critic evalúa con score 0-100 y decide aceptar o regenerar (máx. 3 intentos). Devuelve el resultado final o escalado.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Prompt del usuario para investigar. Ej: 'Investigá el impacto de X en Y'",
        },
        threshold: {
          type: "number",
          description: "Score mínimo para aceptar (0-100, default 80). Por debajo se regenera o escala.",
        },
      },
      required: ["prompt"],
    },
    async handler(args) {
      const prompt = String(args.prompt ?? "").trim()
      if (!prompt) throw new Error("'prompt' es obligatorio")
      const threshold = typeof args.threshold === "number" ? args.threshold : DEFAULT_THRESHOLD

      if (!opencodeApiKey) {
        return {
          content: [{ type: "text", text: "Error: LLM_NOT_CONFIGURED - OPENCODE_GO_API_KEY no está configurada." }],
          isError: true,
        }
      }

      const meshTimeoutMs = parseInt(process.env.SANCTUM_MESH_TIMEOUT_MS ?? "120000", 10)

      const result = await Promise.race([
        runMesh(prompt, threshold, vault, opencodeBaseUrl, opencodeApiKey, tracer),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`MESH_TIMEOUT - El mesh superó el límite de ${meshTimeoutMs}ms`)), meshTimeoutMs),
        ),
      ])

      log.info("sanctum_run_mesh", { traceId: result.trace_id })

      return {
        content: [{ type: "text", text: formatMeshResult(result) }],
      }
    },
  }
}

async function runMesh(
  prompt: string,
  threshold: number,
  vault: VaultAdapter,
  baseUrl: string,
  apiKey: string,
  tracer: TraceWriter,
): Promise<{
  status: "accepted" | "escalated"
  output: string
  final_score: number
  attempts: number
  rejection_reason?: string[]
  trace_id: string
}> {
  const startTime = Date.now()

  const forager = await loadAgentFromVault(vault, "forager.md")
  const researcher = await loadAgentFromVault(vault, "researcher.md")
  const critic = await loadAgentFromVault(vault, "critic.md")

  const foragerBody = renderSystemPrompt(forager, "", prompt)
  const foragerResult = await opencodeChat(foragerBody, prompt, baseUrl, apiKey)

  let bestOutput = ""
  let bestScore = 0
  let lastFeedback: string[] = []
  const attemptHistory: Array<{ attempt: number; score: number }> = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const researcherInput = buildResearcherInput(foragerResult.content, attempt > 1 ? lastFeedback : [])
    const researcherBody = renderSystemPrompt(researcher, "", researcherInput)
    const researcherResult = await opencodeChat(researcherBody, researcherInput, baseUrl, apiKey)
    const output = researcherResult.content
    bestOutput = output

    const criticInput = buildCriticInput(prompt, output)
    const criticBody = renderSystemPrompt(critic, "", criticInput)
    const criticResult = await opencodeChat(criticBody, criticInput, baseUrl, apiKey)
    const evaluation = parseCriticJSON(criticResult.content)

    const score = evaluation.total_score
    const feedback = evaluation.feedback_for_regeneration
    attemptHistory.push({ attempt, score })

    let status: "accepted" | "escalated"
    let reason: string[] | undefined

    if (score >= threshold) {
      status = "accepted"
    } else if (score <= ESCALATE_THRESHOLD) {
      status = "escalated"
      reason = feedback.length > 0 ? feedback : [`Score ${score} está por debajo del umbral de escalate (${ESCALATE_THRESHOLD})`]
    } else if (attempt >= MAX_ATTEMPTS) {
      status = "accepted"
    } else if (attempt > 1 && score <= bestScore) {
      status = "accepted"
    } else {
      if (score > bestScore) {
        bestScore = score
        bestOutput = output
      }
      lastFeedback = feedback
      continue
    }

    const traceId = await tracer.writeTrace({
      type: "mesh_run",
      agent_id: "orchestrator",
      input: { system_prompt: foragerBody, user_prompt: prompt },
      output: bestOutput,
      duration_ms: Date.now() - startTime,
      metadata: {
        status,
        final_score: score,
        attempts: attempt,
        attempt_history: attemptHistory,
        feedback: reason,
      },
    })

    return { status, output: bestOutput, final_score: score, attempts: attempt, rejection_reason: reason, trace_id: traceId }
  }

  // Fallback (should not normally reach)
  const traceId = await tracer.writeTrace({
    type: "mesh_run",
    agent_id: "orchestrator",
    input: { user_prompt: prompt },
    output: bestOutput,
    duration_ms: Date.now() - startTime,
    metadata: { status: "accepted", final_score: bestScore, attempts: MAX_ATTEMPTS },
  })
  return { status: "accepted", output: bestOutput, final_score: bestScore, attempts: MAX_ATTEMPTS, trace_id: traceId }
}

function formatMeshResult(r: {
  status: string
  output: string
  final_score: number
  attempts: number
  rejection_reason?: string[]
  trace_id: string
}): string {
  const lines: string[] = []
  lines.push(`## Mesh ${r.status === "accepted" ? "✅ Aceptado" : "⚠️ Escalado"}`)
  lines.push(`\`\`\`trace_id: ${r.trace_id}\`\`\``)
  lines.push(`- **Score final:** ${r.final_score}/100`)
  lines.push(`- **Intentos:** ${r.attempts}`)
  if (r.rejection_reason?.length) {
    lines.push(`- **Motivo de escalación:**`)
    for (const reason of r.rejection_reason) lines.push(`  - ${reason}`)
  }
  lines.push(``)
  lines.push(`### Output\n${r.output}`)
  return lines.join("\n")
}
