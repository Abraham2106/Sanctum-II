import type { AgentDefinition } from "./types";
import { AGENTS_DIR, DEFAULT_MODEL } from "../constants";
import { parseFrontmatter } from "../shared/agents/frontmatter";

function parseAgentMd(content: string): AgentDefinition {
  const parts = content.split("---");
  if (parts.length < 3) {
    throw new Error("Formato inválido: el archivo debe tener frontmatter --- separado");
  }

  const frontmatterRaw = parts[1].trim();
  const bodyRaw = parts.slice(2).join("---").trim();

  const frontmatter = parseFrontmatter(frontmatterRaw);
  const permissionsRaw = (frontmatter.permissions && typeof frontmatter.permissions === "object")
    ? frontmatter.permissions
    : {};

  return {
    id: frontmatter.id || "unknown",
    name: frontmatter.name || "Sin nombre",
    avatar: frontmatter.avatar || "🤖",
    model: frontmatter.model || DEFAULT_MODEL,
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
