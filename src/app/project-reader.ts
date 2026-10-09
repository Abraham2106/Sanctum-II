/**
 * DEC-0022: portable project resolution for MCP note/query tools.
 */
import type { VaultAdapter } from "../core/vault-adapter";
import { validateVaultSegmentId } from "../core/resource-queue";
import { PROJECTS_DIR } from "../constants";
import { parseProjectMd } from "../projects/project-md";
import type { Project } from "../projects/types";
import { buildEffectiveReadScope, type EffectiveReadScope } from "../runtime/permissions";

export class ProjectRequiredError extends Error {
  constructor() {
    super("PROJECT_REQUIRED");
    this.name = "ProjectRequiredError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`PROJECT_NOT_FOUND: el proyecto '${projectId}' no existe en ${PROJECTS_DIR}/`);
    this.name = "ProjectNotFoundError";
  }
}

/** project_id argument → SANCTUM_PROJECT_ID → error (never first project / global index). */
export function resolveMcpProjectId(args: Record<string, unknown>): string {
  const fromArg = String(args.project_id ?? "").trim();
  if (fromArg) {
    validateProjectId(fromArg);
    return fromArg;
  }
  const fromEnv = String(process.env.SANCTUM_PROJECT_ID ?? "").trim();
  if (fromEnv) {
    validateProjectId(fromEnv);
    return fromEnv;
  }
  throw new ProjectRequiredError();
}

export function validateProjectId(projectId: string): void {
  validateVaultSegmentId(projectId, "project");
}

export function validateAgentId(agentId: string): void {
  validateVaultSegmentId(agentId, "agent");
}

export async function loadProject(vault: VaultAdapter, projectId: string): Promise<Project> {
  validateProjectId(projectId);
  const path = `${PROJECTS_DIR}/${projectId}.md`;
  let content: string;
  try {
    content = await vault.read(path);
  } catch {
    throw new ProjectNotFoundError(projectId);
  }
  const project = parseProjectMd(content);
  if (project.id !== projectId) {
    throw new Error(`Project id mismatch: requested ${projectId}, file has ${project.id}`);
  }
  return project;
}

/** DEC-0022: project ∩ agent read scope for vault note tools. */
export function buildProjectAgentReadScope(
  project: Project,
  agentReadPaths: string[],
): EffectiveReadScope {
  return buildEffectiveReadScope({
    projectReadPaths: project.read_paths,
    agentReadPaths,
  });
}
