import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { pathMatchesAny } from "../../../src/utils.js"
import { log } from "./logger.js"

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`AGENT_NOT_FOUND: el agente '${agentId}' no existe en sanctum-agents/`)
    this.name = "AgentNotFoundError"
  }
}

export interface ResolvedPermissions {
  agentId: string
  readPaths: string[]
  writePaths: string[]
}

function parseFrontmatterFromMd(content: string): Record<string, unknown> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const yaml = match[1]
  const result: Record<string, unknown> = {}
  let currentParent: string | null = null
  let currentNested: Record<string, unknown> | null = null

  for (const line of yaml.split("\n")) {
    // Top-level key:value
    const topKv = line.match(/^(\w+)\s*:\s*(.*)$/)
    if (topKv) {
      // Flush any pending nested object
      if (currentParent && currentNested !== null) {
        result[currentParent] = currentNested
        currentParent = null
        currentNested = null
      }
      const key = topKv[1]
      let value: unknown = topKv[2].trim()
      if (value === "" || value === null) {
        // Starts a nested block
        currentParent = key
        currentNested = {}
        continue
      }
      if (value === "true") value = true
      else if (value === "false") value = false
      else if (/^\d+$/.test(String(value))) value = Number(value)
      else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
      }
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1).split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean)
      }
      result[key] = value
      continue
    }
    // Indented line — belongs to current nested parent
    const nestedKv = line.match(/^\s+(\w+)\s*:\s*(.+)$/)
    if (nestedKv && currentParent && currentNested !== null) {
      let value: unknown = nestedKv[2].trim()
      if (value === "true") value = true
      else if (value === "false") value = false
      else if (/^\d+$/.test(String(value))) value = Number(value)
      else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
      }
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1).split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean)
      }
      currentNested[nestedKv[1]] = value
    }
  }
  // Flush last nested object
  if (currentParent && currentNested !== null) {
    result[currentParent] = currentNested
  }
  return result
}

function extractPermissions(fm: Record<string, unknown>): ResolvedPermissions {
  const perm = (fm.permissions as Record<string, unknown>) ?? {}
  return {
    agentId: String(fm.id ?? ""),
    readPaths: Array.isArray(perm.read_paths) ? (perm.read_paths as string[]) : [],
    writePaths: Array.isArray(perm.write_paths) ? (perm.write_paths as string[]) : [],
  }
}

export async function resolvePermissions(
  vault: VaultAdapter,
  agentId: string,
): Promise<ResolvedPermissions> {
  const fileName = `sanctum-agents/${agentId}.md`
  let content: string
  try {
    content = await vault.read(fileName)
  } catch {
    throw new AgentNotFoundError(agentId)
  }
  const fm = parseFrontmatterFromMd(content)
  const perms = extractPermissions(fm)
  log.debug("permisos resueltos", { agentId, readPaths: perms.readPaths })
  return perms
}

export function checkPathPermission(
  filePath: string,
  permissions: ResolvedPermissions,
): boolean {
  return pathMatchesAny(filePath, permissions.readPaths)
}
