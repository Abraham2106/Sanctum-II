import type { AgentDefinition } from "./types";
import { AGENTS_DIR } from "../constants";
import { splitFrontmatter } from "../shared/agents/frontmatter";

/** DEC-0022: loader keeps absent model as empty string for downstream resolution. */
function modelFromFrontmatter(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseAgentMd(content: string): AgentDefinition {
  const { frontmatter, body: bodyRaw } = splitFrontmatter(content);
  const permissionsRaw = (frontmatter.permissions && typeof frontmatter.permissions === "object")
    ? frontmatter.permissions
    : {};

  return {
    id: frontmatter.id || "unknown",
    name: frontmatter.name || "Sin nombre",
    avatar: frontmatter.avatar || "🤖",
    model: modelFromFrontmatter(frontmatter.model),
    description: frontmatter.description || "",
    triggers: frontmatter.triggers || [],
    tools: frontmatter.tools || [],
    permissions: {
      read_paths: permissionsRaw.read_paths || frontmatter.read_paths || [],
      write_paths: permissionsRaw.write_paths || frontmatter.write_paths || [],
    },
    system_prompt: bodyRaw,
    internal: frontmatter.internal === true || undefined,
  };
}

export async function loadAgentFromVault(
  vaultAdapter: { read: (path: string) => Promise<string> },
  fileName = "agente_base.md"
): Promise<AgentDefinition> {
  const path = `${AGENTS_DIR}/${fileName}`;
  try {
    const content = await vaultAdapter.read(path);
    return parseAgentMd(content);
  } catch (err: any) {
    throw new Error(`No se pudo leer ${path}: ${err.message}`);
  }
}

export function renderSystemPrompt(
  agent: AgentDefinition,
  ragContext: string,
  userPrompt: string
): string {
  return agent.system_prompt
    .replace(/\{\{rag_context\}\}/g, ragContext)
    .replace(/\{\{user_prompt\}\}/g, userPrompt);
}
