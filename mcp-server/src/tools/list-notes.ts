// DEC-0021: el MCP anuncia el uso y lista notas
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

function childPathAuthorized(fullPath: string, scope: ReturnType<typeof buildProjectAgentReadScope>): boolean {
  if (isPathAuthorized(fullPath, scope)) return true
  if (fullPath.endsWith("/")) {
    return isPathAuthorized(`${fullPath}x.md`, scope)
  }
  return isPathAuthorized(`${fullPath}/x.md`, scope)
}

/** Listing allowed when any effective pattern targets this folder or a file beneath it. */
function canListFolder(folderNorm: string, scope: ReturnType<typeof buildProjectAgentReadScope>): boolean {
  if (!scope.allowed) return false
  if (childPathAuthorized(folderNorm, scope) || childPathAuthorized(`${folderNorm}/`, scope)) {
    return true
  }
  for (const layer of scope.layers) {
    for (const pat of layer) {
      const p = pat.startsWith("/") ? pat.slice(1) : pat
      if (p === folderNorm || p.startsWith(`${folderNorm}/`)) return true
      if (p.includes("*")) {
        const prefix = p.split("*")[0].replace(/\/$/, "")
        if (prefix === folderNorm || folderNorm.startsWith(`${prefix}/`)) return true
      }
    }
  }
  return false
}

export function createListNotesTool(vault: VaultAdapter): ToolDef {
  return {
    name: "sanctum_list_notes",
    description:
      "Lista un nivel de notas .md autorizadas (proyecto ∩ agente). Sin folder, devuelve read_paths efectivos.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "ID del proyecto. Si falta, usa SANCTUM_PROJECT_ID.",
        },
        agent_id: {
          type: "string",
          description: "ID del agente; read_paths intersectan con el proyecto.",
        },
        folder: {
          type: "string",
          description: "Carpeta relativa (un nivel). Vacío: read_paths del agente en el proyecto.",
        },
      },
      required: ["agent_id"],
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      const folder = String(args.folder ?? "").trim()

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

      if (!folder) {
        if (!scope.allowed) {
          return {
            content: [{ type: "text", text: "Error: PERMISSION_DENIED" }],
            isError: true,
          }
        }
        const layers = scope.layers.flat().filter(Boolean)
        const text = layers.length > 0 ? layers.join("\n") : "(sin read_paths efectivos)"
        log.info("sanctum_list_notes", { agentId, projectId, mode: "read_paths" })
        return { content: [{ type: "text", text }] }
      }

      if (isPathDenied(folder)) {
        return {
          content: [{ type: "text", text: "Error: PATH_DENIED" }],
          isError: true,
        }
      }

      const folderNorm = folder.replace(/\/$/, "")
      if (!canListFolder(folderNorm, scope)) {
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
        if (!childPathAuthorized(f, scope)) continue
        lines.push(childLabel(f, folder))
      }
      for (const d of listed.folders) {
        if (isInternalPath(d) || folderIsInternal(d)) continue
        const folderPath = d.endsWith("/") ? d : `${d}/`
        if (!childPathAuthorized(folderPath, scope)) continue
        lines.push(`${childLabel(d, folder)}/`)
      }

      lines.sort((a, b) => a.localeCompare(b))

      let output = lines
      if (output.length > MAX_ENTRIES) {
        output = output.slice(0, MAX_ENTRIES)
        output.push(MORE_LINE)
      }

      log.info("sanctum_list_notes", { agentId, projectId, folder, count: lines.length })
      return {
        content: [{ type: "text", text: output.join("\n") || "" }],
      }
    },
  } as ToolDef
}
