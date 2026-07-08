import type { AgentDefinition } from "./types";

const AGENTS_DIR = "sanctum-agents";

function parseFrontmatter(raw: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value: any = trimmed.slice(colonIdx + 1).trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
    } else if (value === "true" || value === "false") {
      value = value === "true";
    } else if (!isNaN(Number(value))) {
      value = Number(value);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }

    result[key] = value;
  }
  return result;
}

function parseAgentMd(content: string): AgentDefinition {
  const parts = content.split("---");
  if (parts.length < 3) {
    throw new Error("Formato inválido: el archivo debe tener frontmatter --- separado");
  }

  const frontmatterRaw = parts[1].trim();
  const bodyRaw = parts.slice(2).join("---").trim();

  const frontmatter = parseFrontmatter(frontmatterRaw);
  const permissionsRaw = frontmatter.permissions || {};

  return {
    id: frontmatter.id || "unknown",
    name: frontmatter.name || "Sin nombre",
    avatar: frontmatter.avatar || "🤖",
    model: frontmatter.model || "deepseek-v4-flash",
    description: frontmatter.description || "",
    triggers: frontmatter.triggers || [],
    tools: frontmatter.tools || [],
    permissions: {
      read_paths: permissionsRaw.read_paths || [],
      write_paths: permissionsRaw.write_paths || [],
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
