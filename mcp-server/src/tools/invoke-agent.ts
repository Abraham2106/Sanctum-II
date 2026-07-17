import type { ToolDef, ToolResult } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { loadAgentFromVault, renderSystemPrompt } from "../../../src/agents/agent-loader.js"
import { resolvePermissions } from "../mcp/permission-resolver.js"
import { opencodeChat } from "../llm/opencode-chat.js"
import { TraceWriter } from "../observability/trace-writer.js"
import { log } from "../mcp/logger.js"

export function createInvokeAgentTool(
  vault: VaultAdapter,
  opencodeBaseUrl: string,
  opencodeApiKey: string,
  tracer: TraceWriter,
  autoCheckTool?: ToolDef,
): ToolDef {
  return {
    name: "sanctum_invoke_agent",
    description:
      "Invoca un agente puntual (no el mesh completo) con un prompt. Carga la definición del agente desde sanctum-agents/, resuelve sus permisos, renderiza el system prompt con el cuerpo del agente, y llama al modelo de lenguaje configurado (deepseek-v4-flash). Devuelve el output crudo del agente + trace_id para correlación.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "ID del agente a invocar (ej. forager, researcher, critic, o un agente custom).",
        },
        prompt: {
          type: "string",
          description: "Prompt del usuario. Se inyecta como {{user_prompt}} en el system prompt del agente.",
        },
        project_id: {
          type: "string",
          description: "Proyecto RAG opcional que se propaga al auto-chequeo del agente.",
        },
      },
      required: ["agent_id", "prompt"],
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      const prompt = String(args.prompt ?? "").trim()
      if (!prompt) throw new Error("'prompt' es obligatorio")

      if (!opencodeApiKey) {
        return {
          content: [{ type: "text", text: "Error: LLM_NOT_CONFIGURED - OPENCODE_GO_API_KEY no está configurada. Configurala en el entorno (mcp.json) para invocar agentes." }],
          isError: true,
        }
      }

      const startTime = Date.now()

      await resolvePermissions(vault, agentId)

      const agent = await loadAgentFromVault(vault, `${agentId}.md`)

      const systemPrompt = renderSystemPrompt(agent, "", prompt)

      const result = await opencodeChat(systemPrompt, prompt, opencodeBaseUrl, opencodeApiKey)

      let output = result.content
      if (agent.auto_check_tool) {
        if (agent.auto_check_tool !== "sanctum_validate_qubo" || !autoCheckTool) {
          output += `\n\n## ⚠️ Auto-chequeo no disponible\nLa tool declarada '${agent.auto_check_tool}' no está registrada en este runtime; la respuesta requiere revisión manual.`
          log.warn("agent auto-check unavailable", { agentId, tool: agent.auto_check_tool })
        } else {
          let check: ToolResult
          try {
            check = await autoCheckTool.handler({
              agent_id: agentId,
              formulation: { expression: result.content },
              context_query: prompt,
              project_id: String(args.project_id ?? "").trim() || undefined,
            })
          } catch (error) {
            check = { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
          }
          const checkText = check.content?.map(item => item.text).join("\n") || "Sin resultado"
          if (check.isError) {
            output += `\n\n## ⚠️ Auto-chequeo QUBO/Ising\n${checkText}`
          } else {
            let parsed: any
            try { parsed = JSON.parse(checkText) } catch { parsed = { issues: [{ code: "AUTO_CHECK_INVALID_OUTPUT", severity: "warning", message: checkText }] } }
            const issues = Array.isArray(parsed.issues) ? parsed.issues : []
            if (issues.length > 0) {
              output += `\n\n## ⚠️ Auto-chequeo QUBO/Ising\nSe detectaron inconsistencias o advertencias; revisá estos puntos antes de usar la formulación:\n${issues.map((issue: any) => `- [${issue.severity || "warning"}] ${issue.message || issue.code}`).join("\n")}`
            } else {
              output += "\n\n## ✅ Auto-chequeo QUBO/Ising\nNo se detectaron inconsistencias en el contexto RAG recuperado."
            }
          }
        }
      }

      const traceId = await tracer.writeTrace({
        type: "agent_invocation",
        agent_id: agentId,
        input: { system_prompt: systemPrompt, user_prompt: prompt },
        output,
        duration_ms: Date.now() - startTime,
      })

      log.info("sanctum_invoke_agent", { agentId, traceId, promptLen: prompt.length, outputLen: result.content.length })

      return {
        content: [
          {
            type: "text",
            text: `## Output de @${agent.name} (${agentId})\n\`\`\`trace_id: ${traceId}\`\`\`\n\n${output}`,
          },
        ],
      }
    },
  }
}
