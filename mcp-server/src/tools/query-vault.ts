import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import type { VectorStore } from "../../../src/rag/vector-store.js"
import { log } from "../mcp/logger.js"
import { resolvePermissions, checkPathPermission } from "../mcp/permission-resolver.js"
import { embedText } from "../embeddings/gemini-embed.js"

const MIN_SIMILARITY = 0.65

export function createQueryVaultTool(
  vault: VaultAdapter,
  store: VectorStore,
  geminiApiKey: string | undefined,
): ToolDef {
  return {
    name: "sanctum_query_vault",
    description:
      "Busca fragmentos relevantes en el vault usando RAG. Recibe una query, la convierte a embedding con Gemini, y devuelve los chunks más similares del vault filtrados por los read_paths del agente. Si el vault no ha sido indexado, devuelve VAULT_NOT_INDEXED.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "ID del agente cuyo read_paths se usa para filtrar los resultados del RAG.",
        },
        query: {
          type: "string",
          description: "Texto o pregunta a buscar en el vault. Se convierte a embedding semántico.",
        },
        max_results: {
          type: "number",
          description: "Máximo de resultados a devolver (default 5).",
        },
      },
      required: ["agent_id", "query"],
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      const query = String(args.query ?? "").trim()
      if (!query) throw new Error("'query' es obligatorio")
      const limit = typeof args.max_results === "number" && args.max_results > 0 ? Math.min(args.max_results, 20) : 5

      if (store.count === 0) {
        log.warn("vault not indexed", { agentId })
        return {
          content: [{ type: "text", text: "Error: VAULT_NOT_INDEXED - El vault no tiene fragmentos indexados. Ejecutá primero el indexador (Research/ u otra carpeta) desde Obsidian antes de consultar por MCP." }],
          isError: true,
        }
      }

      if (!geminiApiKey) {
        log.warn("gemini key no configurada", { agentId })
        return {
          content: [{ type: "text", text: "Error: GEMINI_NOT_CONFIGURED - No hay GEMINI_API_KEYS configuradas en el entorno. Se requiere una key de Gemini para generar embeddings." }],
          isError: true,
        }
      }

      const perms = await resolvePermissions(vault, agentId)

      const embedding = await embedText(query, geminiApiKey)

      const rawResults = store.search(embedding, limit)

      const filtered = rawResults.filter((r) => r.score >= MIN_SIMILARITY)

      const permitted = store.filterByPaths(filtered, perms.readPaths)

      log.info("sanctum_query_vault", {
        agentId,
        query: query.slice(0, 80),
        raw: rawResults.length,
        filtered: filtered.length,
        permitted: permitted.length,
      })

      if (permitted.length === 0) {
        return {
          content: [{ type: "text", text: `Sin resultados relevantes para "${query}" en los paths permitidos para '${agentId}' read_paths: ${JSON.stringify(perms.readPaths)}.` }],
        }
      }

      const text = permitted
        .map((r, i) => {
          const note = r.chunk.note_path
          const excerpt = r.chunk.chunk_text.slice(0, 400).trim()
          return `### ${i + 1}. ${note}  (similitud: ${(r.score * 100).toFixed(0)}%)\n\n${excerpt}${r.chunk.chunk_text.length > 400 ? "..." : ""}`
        })
        .join("\n\n---\n\n")

      return {
        content: [{ type: "text", text }],
      }
    },
  }
}
