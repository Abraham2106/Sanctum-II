import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { AGENTS_DIR } from "../../../src/constants.js"
import { validateAgentId } from "../../../src/app/project-reader.js"
import { pathMatchesAny } from "../../../src/utils.js"
import { log } from "./logger.js"
import { FrontmatterError, splitFrontmatter } from "../../../src/shared/agents/frontmatter.js"

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`AGENT_NOT_FOUND: el agente '${agentId}' no existe en ${AGENTS_DIR}/`)
    this.name = "AgentNotFoundError"
  }
}

export interface ResolvedPermissions {
  agentId: string
  readPaths: string[]
  writePaths: string[]
}

function extractPermissions(fm: Record<string, unknown>, agentId: string): ResolvedPermissions {
  const perm = (fm.permissions as Record<string, unknown>) ?? {}
  return {
    agentId: String(fm.id ?? agentId),
    readPaths: Array.isArray(perm.read_paths) ? (perm.read_paths as string[]) : [],
    writePaths: Array.isArray(perm.write_paths) ? (perm.write_paths as string[]) : [],
  }
}

function wrapFrontmatterError(agentPath: string, err: unknown): never {
  if (err instanceof FrontmatterError) {
    throw new Error(`${agentPath}: ${err.message}`)
  }
  throw err
}

export async function resolvePermissions(
  vault: VaultAdapter,
  agentId: string,
): Promise<ResolvedPermissions> {
  validateAgentId(agentId)
  const fileName = `${AGENTS_DIR}/${agentId}.md`
  let content: string
  try {
    content = await vault.read(fileName)
  } catch {
    throw new AgentNotFoundError(agentId)
  }
  let fm: Record<string, unknown>
  try {
    fm = splitFrontmatter(content).frontmatter
  } catch (err) {
    wrapFrontmatterError(fileName, err)
  }
  const perms = extractPermissions(fm!, agentId)
  log.debug("permisos resueltos", { agentId, readPaths: perms.readPaths })
  return perms
}

/** Agent-only path check (prefer project ∩ agent scope in note tools). */
export function checkPathPermission(
  filePath: string,
  permissions: ResolvedPermissions,
): boolean {
  return pathMatchesAny(filePath, permissions.readPaths)
}
