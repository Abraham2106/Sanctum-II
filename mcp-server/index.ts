#!/usr/bin/env node
import path from "node:path"
import { McpServer } from "./src/mcp/server.js"
import { FsVaultAdapter } from "./src/core/fs-vault-adapter.js"
import { ProjectRagRuntimeRegistry } from "./src/rag/project-rag-runtime.js"
import { createListAgentsTool } from "./src/tools/list-agents.js"
import { createGetNoteTool } from "./src/tools/get-note.js"
import { createQueryVaultTool } from "./src/tools/query-vault.js"
import { createValidateQuboTool } from "./src/tools/validate-qubo.js"
import { createInvokeAgentTool } from "./src/tools/invoke-agent.js"
import { createRunMeshTool } from "./src/tools/run-mesh.js"
import { TraceWriter } from "./src/observability/trace-writer.js"
import { log } from "./src/mcp/logger.js"

async function main(): Promise<void> {
  const vaultRoot = process.env.SANCTUM_VAULT_PATH ?? path.resolve(process.cwd(), "notes")
  log.info("iniciando sanctum mcp", { vaultRoot })

  const vault = new FsVaultAdapter(vaultRoot)
  const server = new McpServer({ name: "sanctum-mcp", version: "0.1.0" })

  // ── Agentes ──
  server.registerTool(createListAgentsTool(vault))
  server.registerTool(createGetNoteTool(vault))

  // ── RAG (VectorStore + Gemini embeddings) ──
  const geminiApiKey = process.env.GEMINI_API_KEYS?.split(",")[0]?.trim()
  const ragRegistry = new ProjectRagRuntimeRegistry(vault, geminiApiKey, process.env.SANCTUM_PROJECT_ID?.trim())
  await ragRegistry.initialize()
  const resolveRag = (projectId?: string) => ragRegistry.resolve(projectId)
  log.info("runtime RAG cargado", { hasKey: !!geminiApiKey, defaultProjectId: process.env.SANCTUM_PROJECT_ID?.trim() })
  server.registerTool(createQueryVaultTool(vault, resolveRag, geminiApiKey))
  const validateQuboTool = createValidateQuboTool(vault, resolveRag, geminiApiKey)
  server.registerTool(validateQuboTool)

  // ── LLM (OpenCode) ──
  const opencodeBaseUrl = process.env.OPENCODE_GO_BASE_URL ?? "https://api.opencode.ai/v1"
  const opencodeApiKey = (process.env.OPENCODE_GO_API_KEY ?? "").trim()
  const tracer = new TraceWriter(vault)
  log.info("opencode config", { hasKey: !!opencodeApiKey, baseUrl: opencodeBaseUrl })
  server.registerTool(createInvokeAgentTool(vault, opencodeBaseUrl, opencodeApiKey, tracer, validateQuboTool))
  server.registerTool(createRunMeshTool(vault, opencodeBaseUrl, opencodeApiKey, tracer))

  server.start()
}

main().catch((err) => {
  log.error("error fatal en main", { error: String(err) })
  process.exit(1)
})
