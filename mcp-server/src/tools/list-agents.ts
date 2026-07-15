import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { log } from "../mcp/logger.js"
import { parseFrontmatter } from "../../../src/shared/agents/frontmatter.js"

interface AgentMeta {
  id: string
  name: string
  avatar: string
  description: string
  fixed: boolean
}

function loadAgents(vault: VaultAdapter): Promise<AgentMeta[]> {
  return vault.list("sanctum-agents").then(async ({ files }) => {
    const mdFiles = files.filter((f) => f.toLowerCase().endsWith(".md"))
    const agents: AgentMeta[] = []

    for (const f of mdFiles) {
      try {
        const content = await vault.read(f)
        const mc = content.match(/^---\s*\n([\s\S]*?)\n---/)
        if (!mc) continue
        const fm = parseFrontmatter(mc[1])
        const id = fm.id
        if (!id || typeof id !== "string") continue

        const internal = fm.internal === true
        agents.push({
          id,
          name: (fm.name as string) ?? id,
          avatar: (fm.avatar as string) ?? "🤖",
          description: (fm.description as string) ?? "",
          fixed: !internal,
        })
      } catch (err) {
        log.warn("error leyendo agente", { file: f, error: String(err) })
      }
    }

    agents.sort((a, b) => a.id.localeCompare(b.id))
    return agents
  })
}

export function createListAgentsTool(vault: VaultAdapter): ToolDef {
  return {
    name: "sanctum_list_agents",
    description:
      "Lista todos los agentes disponibles en el vault (fijos del sistema + custom del usuario). Devuelve metadata de cada agente: id, name, avatar, description y si es fijo o custom.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async handler() {
      const agents = await loadAgents(vault)
      log.info("sanctum_list_agents", { count: agents.length })
      const text = agents
        .map(
          (a) =>
            `${a.avatar} **${a.name}** (\`${a.id}\`)${a.fixed ? " — *fijo del sistema*" : " — *custom*"}\n${a.description}`,
        )
        .join("\n\n")
      return {
        content: [{ type: "text", text: text || "No se encontraron agentes." }],
      }
    },
  }
}
