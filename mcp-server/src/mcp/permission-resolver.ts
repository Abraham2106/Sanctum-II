import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { pathMatchesAny } from "../../../src/utils.js"
import { log } from "./logger.js"
import { splitFrontmatter } from "../../../src/shared/agents/frontmatter.js"

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
  let fm: Record<string, unknown>
  try { fm = splitFrontmatter(content).frontmatter } catch { fm = {} }
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
