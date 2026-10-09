import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { loadAgentFromVault, renderSystemPrompt } from "../../../src/agents/agent-loader.js"
import { opencodeChat } from "../llm/opencode-chat.js"
import { TraceWriter } from "../observability/trace-writer.js"
import { log } from "../mcp/logger.js"
import { readToolContext } from "./tool-context.js"

import { MESH_DEFAULTS } from "../../../src/shared/mesh/types.js"
import type { MeshRunResult } from "../../../src/shared/mesh/types.js"
import { runMeshCore } from "../../../src/runtime/mesh.js"

export function createRunMeshTool(
  vault: VaultAdapter,
  opencodeBaseUrl: string,
  opencodeApiKey: string,
  tracer: TraceWriter,
): ToolDef {
  return {
    name: "sanctum_run_mesh",
    description:
      "Corre Forager, Researcher y Critic. No lee el vault. context es el contexto de Forager. Gasta OPENCODE_GO_API_KEY.",
    annotations: { readOnlyHint: false, openWorldHint: true },
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
        context: {
          type: "string",
          description: "Texto ya recuperado del vault. Entra como contexto.",
        },
      },
      required: ["prompt"],
    },
    async handler(args) {
      const prompt = String(args.prompt ?? "").trim()
      if (!prompt) throw new Error("'prompt' es obligatorio")
      const threshold = typeof args.threshold === "number" ? args.threshold : MESH_DEFAULTS.ACCEPT_THRESHOLD

      if (!opencodeApiKey) {
        return {
          content: [{ type: "text", text: "Error: LLM_NOT_CONFIGURED - OPENCODE_GO_API_KEY no está configurada." }],
          isError: true,
        }
      }

      const meshTimeoutMs = parseInt(process.env.SANCTUM_MESH_TIMEOUT_MS ?? "120000", 10)
      const foragerRag = readToolContext(args)

      const result = await runMeshCore(
        {
          runForager: async (userPrompt, signal) => {
            const forager = await loadAgentFromVault(vault, "forager.md")
            const foragerBody = renderSystemPrompt(forager, foragerRag, userPrompt)
            return opencodeChat(foragerBody, userPrompt, opencodeBaseUrl, opencodeApiKey, { signal })
          },
          runResearcher: async (input, signal) => {
            const researcher = await loadAgentFromVault(vault, "researcher.md")
            const researcherBody = renderSystemPrompt(researcher, "", input)
            return opencodeChat(researcherBody, input, opencodeBaseUrl, opencodeApiKey, { signal })
          },
          runCritic: async (input, signal) => {
            const critic = await loadAgentFromVault(vault, "critic.md")
            const criticBody = renderSystemPrompt(critic, "", input)
            return opencodeChat(criticBody, input, opencodeBaseUrl, opencodeApiKey, { signal })
          },
        },
        {
          userPrompt: prompt,
          provenance: "sanctum.mcp.mesh",
          acceptThreshold: threshold,
          timeoutMs: meshTimeoutMs,
        },
      )

      const traceId = await tracer.writeTrace({
        type: "mesh_run",
        agent_id: "orchestrator",
        input: { user_prompt: prompt },
        output: result.selectedAttempt?.output ?? "",
        duration_ms: 0,
        metadata: {
          status: result.status,
          final_score: result.selectedAttempt?.score,
          attempts: result.attempts.length,
          attempt_history: result.attempts.map((a) => ({
            attempt: a.attempt,
            score: a.evaluation.total_score,
          })),
        },
      })

      log.info("sanctum_run_mesh", { traceId, status: result.status })

      return {
        content: [{ type: "text", text: formatMeshResult(result, traceId) }],
        isError: result.status === "failed",
      }
    },
  }
}

function formatMeshResult(r: MeshRunResult, traceId: string): string {
  const lines: string[] = []
  const headline =
    r.status === "accepted"
      ? "✅ Aceptado"
      : r.status === "escalated"
        ? "⚠️ Escalado"
        : r.status === "needs_review"
          ? "🔍 Needs review"
          : r.status === "timed_out"
            ? "⏱️ Timed out"
            : r.status === "cancelled"
              ? "🛑 Cancelado"
              : "❌ Fallido"
  lines.push(`## Mesh ${headline}`)
  lines.push(`\`\`\`trace_id: ${traceId}\`\`\``)
  lines.push(`- **Estado:** ${r.status}`)
  lines.push(`- **Score final:** ${r.selectedAttempt?.score ?? "N/A"}/100`)
  lines.push(`- **Intentos:** ${r.attempts.length}`)
  if (r.escalationReason?.length) {
    lines.push(`- **Motivo de escalación:**`)
    for (const reason of r.escalationReason) lines.push(`  - ${reason}`)
  }
  lines.push(``)
  lines.push(`### Output\n${r.selectedAttempt?.output ?? ""}`)
  return lines.join("\n")
}
