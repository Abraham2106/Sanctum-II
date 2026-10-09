import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { loadAgentFromVault, renderSystemPrompt } from "../../../src/agents/agent-loader.js"
import { resolvePermissions } from "../mcp/permission-resolver.js"
import { opencodeChat } from "../llm/opencode-chat.js"
import { TraceWriter } from "../observability/trace-writer.js"
import { log } from "../mcp/logger.js"
import { readToolContext } from "./tool-context.js"
import { validateAgentId, loadProject } from "../../../src/app/project-reader.js"
import { globalChatConfigFromEnv, resolveChatCall } from "../../../src/runtime/providers.js"
import type { CallOptions } from "../../../src/runtime/ports.js"

export function createInvokeAgentTool(
  vault: VaultAdapter,
  opencodeBaseUrl: string,
  opencodeApiKey: string,
  tracer: TraceWriter,
): ToolDef {
  return {
    name: "sanctum_invoke_agent",
    description:
      "Llama al agente con su prompt. Usa context suministrado (sin RAG oculto). Modelo/proveedor: argumento > agente > proyecto > env.",
    annotations: { readOnlyHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "ID del agente a invocar.",
        },
        prompt: {
          type: "string",
          description: "Prompt del usuario ({{user_prompt}}).",
        },
        context: {
          type: "string",
          description: "Texto ya recuperado; entra como contexto RAG inyectado.",
        },
        project_id: {
          type: "string",
          description: "Opcional: proyecto para resolver model del proyecto (sin indexar ni buscar).",
        },
        model: {
          type: "string",
          description: "Override opcional de modelo LLM para esta llamada.",
        },
        provider: {
          type: "string",
          description: "Override opcional de proveedor LLM (openai | anthropic).",
        },
      },
      required: ["agent_id", "prompt"],
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      validateAgentId(agentId)
      const prompt = String(args.prompt ?? "").trim()
      if (!prompt) throw new Error("'prompt' es obligatorio")

      if (!opencodeApiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Error: LLM_NOT_CONFIGURED - OPENCODE_GO_API_KEY no está configurada. Configurala en el entorno (mcp.json) para invocar agentes.",
            },
          ],
          isError: true,
        }
      }

      const startTime = Date.now()
      await resolvePermissions(vault, agentId)

      const agent = await loadAgentFromVault(vault, `${agentId}.md`)

      let projectModel = ""
      const projectArg = String(args.project_id ?? "").trim()
      if (projectArg) {
        const project = await loadProject(vault, projectArg)
        projectModel = project.model
      }

      const callOverrides: CallOptions = {}
      if (typeof args.model === "string" && args.model.trim()) {
        callOverrides.model = args.model.trim()
      }
      if (typeof args.provider === "string" && args.provider.trim()) {
        callOverrides.provider = args.provider.trim()
      }

      const resolved = resolveChatCall({
        call: callOverrides,
        agentModel: agent.model,
        projectModel,
        global: globalChatConfigFromEnv(process.env),
      })

      const systemPrompt = renderSystemPrompt(agent, readToolContext(args), prompt)

      const result = await opencodeChat(systemPrompt, prompt, opencodeBaseUrl, opencodeApiKey, resolved)

      const traceId = await tracer.writeTrace({
        type: "agent_invocation",
        agent_id: agentId,
        input: { system_prompt: systemPrompt, user_prompt: prompt },
        output: result.content,
        duration_ms: Date.now() - startTime,
      })

      log.info("sanctum_invoke_agent", {
        agentId,
        traceId,
        model: resolved.model,
        provider: resolved.provider,
        promptLen: prompt.length,
        outputLen: result.content.length,
      })

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
