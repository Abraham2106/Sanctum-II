import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import type { Project } from "../../../src/projects/types.js"
import type { EmbedderPort, VectorIdentity } from "../../../src/runtime/ports.js"
import { log } from "../mcp/logger.js"
import { resolvePermissions } from "../mcp/permission-resolver.js"
import {
  buildProjectAgentReadScope,
  loadProject,
  ProjectRequiredError,
  resolveMcpProjectId,
} from "../../../src/app/project-reader.js"
import {
  loadGenerationVectorStore,
  loadIndexGenerationSnapshot,
} from "../../../src/projects/index-generations.js"
import { vectorIdentityFromMetadata } from "../../../src/projects/index-generations-seal.js"
import type { VectorStore } from "../../../src/rag/vector-store.js"
import {
  embeddingMatchesDims,
  evaluatePreEmbedStoreIdentity,
  retrieveContextChunks,
} from "../../../src/runtime/retrieval.js"
import { RAG_DEFAULTS } from "../../../src/constants.js"

export interface QueryVaultDeps {
  vault: VaultAdapter
  createEmbedderForProject: (project: Project) => EmbedderPort
}

function createVectorStorePort(store: VectorStore, identity: VectorIdentity) {
  return {
    count: store.count,
    identity,
    allChunks: () =>
      store.allChunks.map((c) => ({
        id: c.id,
        notePath: c.note_path,
        chunkText: c.chunk_text,
        embedding: c.embedding,
      })),
  }
}

function skipReasonMessage(reason: string, projectId: string): string {
  switch (reason) {
    case "scope_denied":
      return `Sin resultados: read scope denegado para '${projectId}'.`
    case "identity_mismatch":
      return "Error: INDEX_IDENTITY_MISMATCH - El índice no coincide con el embedding configurado."
    case "rebuild_required":
      return "Error: INDEX_REBUILD_REQUIRED - No hay generación sellada válida para este proyecto."
    case "empty_store":
      return "Error: VAULT_NOT_INDEXED - La generación no tiene fragmentos indexados."
    case "embedding_dims_mismatch":
      return "Error: EMBEDDING_DIMS_MISMATCH - Dimensiones de query incompatibles."
    default:
      return `Sin resultados relevantes (${reason}).`
  }
}

export function createQueryVaultTool(deps: QueryVaultDeps): ToolDef {
  return {
    name: "sanctum_query_vault",
    description:
      "Busca fragmentos en la generación de índice publicada del proyecto (refresco por llamada). Requiere project_id o SANCTUM_PROJECT_ID.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "ID del proyecto indexado. Si falta, usa SANCTUM_PROJECT_ID.",
        },
        agent_id: {
          type: "string",
          description: "ID del agente; filtra candidatos con proyecto ∩ read_paths antes del top-k.",
        },
        query: {
          type: "string",
          description: "Texto o pregunta a buscar.",
        },
        max_results: {
          type: "number",
          description: "Máximo de resultados (default 5, máx 20).",
        },
      },
      required: ["agent_id", "query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      const query = String(args.query ?? "").trim()
      if (!query) throw new Error("'query' es obligatorio")
      const limit =
        typeof args.max_results === "number" && args.max_results > 0
          ? Math.min(args.max_results, 20)
          : RAG_DEFAULTS.TOP_K

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

      const project = await loadProject(deps.vault, projectId)
      const snapshot = await loadIndexGenerationSnapshot(deps.vault, projectId)

      if (snapshot.status !== "ready" || !snapshot.metadata) {
        log.warn("index not ready", { projectId, status: snapshot.status, reason: snapshot.reason })
        const code =
          snapshot.status === "rebuild_required" ? "INDEX_REBUILD_REQUIRED" : "VAULT_NOT_INDEXED"
        return {
          content: [{ type: "text", text: `Error: ${code} - Índice no disponible para '${projectId}'.` }],
          isError: true,
        }
      }

      const store = await loadGenerationVectorStore(deps.vault, projectId, snapshot.generationId)
      if (!store || store.count === 0) {
        return {
          content: [{ type: "text", text: "Error: VAULT_NOT_INDEXED - La generación no tiene chunks." }],
          isError: true,
        }
      }

      const storeIdentity = vectorIdentityFromMetadata(snapshot.metadata)
      const preEmbedDeny = evaluatePreEmbedStoreIdentity(project.rag, storeIdentity, projectId)
      if (preEmbedDeny) {
        return {
          content: [{ type: "text", text: skipReasonMessage(preEmbedDeny, projectId) }],
          isError: preEmbedDeny !== "scope_denied",
        }
      }

      const embedder = deps.createEmbedderForProject(project)
      if (!embedder.hasKeys) {
        const backend = project.embedding?.backend ?? "gemini"
        const code = backend === "sentence-transformers" ? "LOCAL_EMBED_NOT_CONFIGURED" : "GEMINI_NOT_CONFIGURED"
        return {
          content: [{ type: "text", text: `Error: ${code} - Proveedor de embedding no configurado.` }],
          isError: true,
        }
      }

      const queryIdentity: VectorIdentity = storeIdentity
      let queryEmbedding: number[]
      try {
        queryEmbedding = await embedder.embed(query, {
          model: queryIdentity.embedModel,
          purpose: "query",
          expectedIdentity: snapshot.metadata.identity,
        })
      } catch (err) {
        log.warn("embed failed", { projectId, error: String(err) })
        return {
          content: [{ type: "text", text: `Error: EMBED_FAILED - ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }

      if (!embeddingMatchesDims(queryEmbedding, queryIdentity.dims)) {
        return {
          content: [{ type: "text", text: "Error: EMBEDDING_DIMS_MISMATCH" }],
          isError: true,
        }
      }

      const perms = await resolvePermissions(deps.vault, agentId)
      const scope = buildProjectAgentReadScope(project, perms.readPaths)
      const minSim = project.rag.min_similarity ?? RAG_DEFAULTS.MIN_SIMILARITY

      const { chunks, skipReason } = retrieveContextChunks({
        queryEmbedding,
        queryIdentity,
        store: createVectorStorePort(store, storeIdentity),
        scope,
        topK: limit,
        minSimilarity: minSim,
      })

      log.info("sanctum_query_vault", {
        agentId,
        projectId,
        generationId: snapshot.generationId,
        query: query.slice(0, 80),
        hits: chunks.length,
        skipReason,
      })

      if (skipReason && chunks.length === 0) {
        return {
          content: [{ type: "text", text: skipReasonMessage(skipReason, projectId) }],
          isError: skipReason === "identity_mismatch" || skipReason === "rebuild_required",
        }
      }

      if (chunks.length === 0) {
        return {
          content: [{ type: "text", text: `Sin resultados relevantes para "${query}" en '${projectId}'.` }],
        }
      }

      const text = chunks
        .map((r, i) => {
          const excerpt = r.chunkText.slice(0, 400).trim()
          return `### ${i + 1}. ${r.notePath}  (similitud: ${(r.score * 100).toFixed(0)}%)\n\n${excerpt}${r.chunkText.length > 400 ? "..." : ""}`
        })
        .join("\n\n---\n\n")

      return {
        content: [{ type: "text", text }],
      }
    },
  }
}
