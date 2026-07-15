import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { log } from "../mcp/logger.js"
import { resolvePermissions, checkPathPermission } from "../mcp/permission-resolver.js"

export function createGetNoteTool(vault: VaultAdapter): ToolDef {
  return {
    name: "sanctum_get_note",
    description:
      "Lee una nota del vault por su path relativo. Valida que el agente tenga permisos (read_paths) sobre la ruta antes de leer el archivo. Si el path no está cubierto por los read_paths del agente, devuelve PERMISSION_DENIED sin tocar el filesystem.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "ID del agente (ej. forager, researcher, critic). Sus read_paths determinan si la lectura está autorizada.",
        },
        path: {
          type: "string",
          description: "Ruta relativa de la nota dentro del vault (ej. Research/nota.md o sanctum-agents/forager.md).",
        },
      },
      required: ["agent_id", "path"],
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      const notePath = String(args.path ?? "").trim()
      if (!notePath) throw new Error("'path' es obligatorio")

      const perms = await resolvePermissions(vault, agentId)

      if (!checkPathPermission(notePath, perms)) {
        log.warn("permission denied", { agentId, notePath, readPaths: perms.readPaths })
        return {
          content: [
            {
              type: "text",
              text: `Error: PERMISSION_DENIED - El agente '${agentId}' no tiene read_paths que cubran '${notePath}'. read_paths del agente: ${JSON.stringify(perms.readPaths)}`,
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

      log.info("sanctum_get_note", { agentId, notePath })
      return {
        content: [{ type: "text", text: `# ${notePath}\n\n${content}` }],
      }
    },
  }
}
