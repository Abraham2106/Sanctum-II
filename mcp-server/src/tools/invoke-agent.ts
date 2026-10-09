import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { loadAgentFromVault, renderSystemPrompt } from "../../../src/agents/agent-loader.js"
import { resolvePermissions } from "../mcp/permission-resolver.js"
import { opencodeChat } from "../llm/opencode-chat.js"
import { TraceWriter } from "../observability/trace-writer.js"
import { log } from "../mcp/logger.js"
import { readToolContext } from "./tool-context.js"

export function createInvokeAgentTool(
  vault: VaultAdapter,
  opencodeBaseUrl: string,
  opencodeApiKey: string,
  tracer: TraceWriter,
): ToolDef {
  return {
    name: "sanctum_invoke_agent",
    // DEC-0021: el MCP anuncia el uso y lista notas
    description:
      "Llama al agente con su prompt. No busca en el vault. context entra como contexto. Gasta OPENCODE_GO_API_KEY.",
    annotations: { readOnlyHint: false, openWorldHint: true },
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
        context: {
          type: "string",
          description: "Texto ya recuperado del vault. Entra como contexto.",
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

      const systemPrompt = renderSystemPrompt(agent, readToolContext(args), prompt)

      const result = await opencodeChat(systemPrompt, prompt, opencodeBaseUrl, opencodeApiKey)

      const traceId = await tracer.writeTrace({
        type: "agent_invocation",
        agent_id: agentId,
        input: { system_prompt: systemPrompt, user_prompt: prompt },
        output: result.content,
        duration_ms: Date.now() - startTime,
      })

      log.info("sanctum_invoke_agent", { agentId, traceId, promptLen: prompt.length, outputLen: result.content.length })

      return {
        content: [
          {
            type: "text",
            text: `## Output de @${agent.name} (${agentId})\n\`\`\`trace_id: ${traceId}\`\`\`\n\n${result.content}`,
          },
        ],
      }
    },
  }
}
