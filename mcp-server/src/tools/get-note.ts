import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { log } from "../mcp/logger.js"
import { resolvePermissions } from "../mcp/permission-resolver.js"
import {
  buildProjectAgentReadScope,
  loadProject,
  ProjectRequiredError,
  resolveMcpProjectId,
} from "../../../src/app/project-reader.js"
import { isPathAuthorized } from "../../../src/runtime/permissions.js"

export function createGetNoteTool(vault: VaultAdapter): ToolDef {
  return {
    name: "sanctum_get_note",
    description:
      "Lee una nota del vault por path relativo dentro de un proyecto. Valida proyecto ∩ agente read_paths antes de leer.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "ID del proyecto (sanctum-projects). Si falta, usa SANCTUM_PROJECT_ID.",
        },
        agent_id: {
          type: "string",
          description: "ID del agente; sus read_paths se intersectan con los del proyecto.",
        },
        path: {
          type: "string",
          description: "Ruta relativa de la nota (ej. Research/nota.md).",
        },
      },
      required: ["agent_id", "path"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      const notePath = String(args.path ?? "").trim()
      if (!notePath) throw new Error("'path' es obligatorio")

      let projectId: string
      try {
        projectId = resolveMcpProjectId(args)
      } catch (err) {
        if (err instanceof ProjectRequiredError) {
          return {
            content: [{ type: "text", text: "Error: PROJECT_REQUIRED" }],
            isError: true,
          }
        }
        throw err
      }

      const project = await loadProject(vault, projectId)
      const perms = await resolvePermissions(vault, agentId)
      const scope = buildProjectAgentReadScope(project, perms.readPaths)

      if (!scope.allowed || !isPathAuthorized(notePath, scope)) {
        log.warn("permission denied", { agentId, projectId, notePath })
        return {
          content: [
            {
              type: "text",
              text: `Error: PERMISSION_DENIED - '${agentId}' no puede leer '${notePath}' en proyecto '${projectId}'.`,
            },
          ],
          isError: true,
        }
      }

      let content: string
      try {
        content = await vault.read(notePath)
      } catch {
        return {
          content: [{ type: "text", text: `Error: FILE_NOT_FOUND - No se encontró la nota '${notePath}' en el vault` }],
          isError: true,
        }
      }

      log.info("sanctum_get_note", { agentId, projectId, notePath })
      return {
        content: [{ type: "text", text: `# ${notePath}\n\n${content}` }],
      }
    },
  }
}
