// DEC-0021: el MCP anuncia el uso y lista notas
import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { log } from "../mcp/logger.js"
import { resolvePermissions, checkPathPermission } from "../mcp/permission-resolver.js"
import { isInternalPath } from "../../../src/utils.js"

const MAX_ENTRIES = 200
const MORE_LINE = "hay más; afina el folder"

function isPathDenied(folder: string): boolean {
  return folder.includes("..") || folder.startsWith("/") || folder.includes("\\")
}

function childLabel(fullPath: string, folder: string): string {
  const base = folder.replace(/\/$/, "")
  const prefix = base ? `${base}/` : ""
  if (prefix && fullPath.startsWith(prefix)) return fullPath.slice(prefix.length)
  const slash = fullPath.lastIndexOf("/")
  return slash >= 0 ? fullPath.slice(slash + 1) : fullPath
}

function folderIsInternal(folderPath: string): boolean {
  const name = folderPath.replace(/\/$/, "").split("/").pop() ?? folderPath
  return isInternalPath(name) || isInternalPath(`${name}/`)
}

export function createListNotesTool(vault: VaultAdapter): ToolDef {
  return {
    name: "sanctum_list_notes",
    description:
      "Lista un nivel de notas .md que el agente puede leer. Sin folder, devuelve sus read_paths.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "ID del agente; sus read_paths definen qué carpetas puede listar.",
        },
        folder: {
          type: "string",
          description: "Carpeta relativa dentro del vault (un nivel). Vacío: solo read_paths.",
        },
      },
      required: ["agent_id"],
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      const folder = String(args.folder ?? "").trim()

      const perms = await resolvePermissions(vault, agentId)

      if (!folder) {
        const lines = perms.readPaths
        const text = lines.length > 0 ? lines.join("\n") : "(sin read_paths)"
        log.info("sanctum_list_notes", { agentId, mode: "read_paths" })
        return { content: [{ type: "text", text }] }
      }

      if (isPathDenied(folder)) {
        return {
          content: [{ type: "text", text: "Error: PATH_DENIED" }],
          isError: true,
        }
      }

      const folderNorm = folder.replace(/\/$/, "")
      const allowed =
        checkPathPermission(folder, perms) ||
        checkPathPermission(`${folderNorm}/a.md`, perms)
      if (!allowed) {
        return {
          content: [{ type: "text", text: "Error: PERMISSION_DENIED" }],
          isError: true,
        }
      }

      let listed: { files: string[]; folders: string[] }
      try {
        listed = await vault.list(folder)
      } catch {
        return {
          content: [{ type: "text", text: "Error: PATH_DENIED" }],
          isError: true,
        }
      }

      const lines: string[] = []
      for (const f of listed.files) {
        if (!f.toLowerCase().endsWith(".md")) continue
        if (isInternalPath(f)) continue
        lines.push(childLabel(f, folder))
      }
      for (const d of listed.folders) {
        if (isInternalPath(d) || folderIsInternal(d)) continue
        lines.push(`${childLabel(d, folder)}/`)
      }

      lines.sort((a, b) => a.localeCompare(b))

      let output = lines
      if (output.length > MAX_ENTRIES) {
        output = output.slice(0, MAX_ENTRIES)
        output.push(MORE_LINE)
      }

      log.info("sanctum_list_notes", { agentId, folder, count: lines.length })
      return {
        content: [{ type: "text", text: output.join("\n") || "" }],
      }
    },
  } as ToolDef
}
