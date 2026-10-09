#!/usr/bin/env node
import path from "node:path"
import { McpServer } from "./src/mcp/server.js"
import { FsVaultAdapter } from "./src/core/fs-vault-adapter.js"
import { createListAgentsTool } from "./src/tools/list-agents.js"
import { createGetNoteTool } from "./src/tools/get-note.js"
import { createQueryVaultTool } from "./src/tools/query-vault.js"
import { createInvokeAgentTool } from "./src/tools/invoke-agent.js"
import { createRunMeshTool } from "./src/tools/run-mesh.js"
import { createListNotesTool } from "./src/tools/list-notes.js"
import { TraceWriter } from "./src/observability/trace-writer.js"
import { log } from "./src/mcp/logger.js"
import { startMcpHttp } from "./src/mcp/http.js"
import { DEFAULT_SETTINGS } from "../src/constants.js"
import { createConfiguredEmbedderPort } from "../src/runtime/embedding.js"
import type { EmbeddingEnvSlice } from "../src/embeddings/embedding-config.js"
import type { Project } from "../src/projects/types.js"
import { embedText } from "./src/embeddings/gemini-embed.js"
import type { GeminiBalancer } from "../src/embeddings/gemini-balancer.js"

function embeddingEnvFromProcess(env: NodeJS.ProcessEnv): EmbeddingEnvSlice {
  return {
    SANCTUM_EMBED_BACKEND: env.SANCTUM_EMBED_BACKEND,
    SANCTUM_LOCAL_EMBED_PORT: env.SANCTUM_LOCAL_EMBED_PORT,
    SANCTUM_LOCAL_EMBED_TOKEN: env.SANCTUM_LOCAL_EMBED_TOKEN,
    SANCTUM_LOCAL_EMBED_REVISION: env.SANCTUM_LOCAL_EMBED_REVISION,
    SANCTUM_LOCAL_EMBED_DIMS: env.SANCTUM_LOCAL_EMBED_DIMS,
    SANCTUM_LOCAL_EMBED_DEVICE: env.SANCTUM_LOCAL_EMBED_DEVICE,
    SANCTUM_LOCAL_EMBED_DTYPE: env.SANCTUM_LOCAL_EMBED_DTYPE,
    GEMINI_API_KEYS: env.GEMINI_API_KEYS,
  }
}

function parseAllowedOrigins(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const list = trimmed
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
  return list.length > 0 ? list : undefined
}

async function main(): Promise<void> {
  const vaultRoot = process.env.SANCTUM_VAULT_PATH ?? path.resolve(process.cwd(), "notes")
  log.info("iniciando sanctum mcp", { vaultRoot })

  const vault = new FsVaultAdapter(vaultRoot)
  const server = new McpServer({ name: "sanctum-mcp", version: "0.1.0" })

  server.registerTool(createListAgentsTool(vault))
  server.registerTool(createGetNoteTool(vault))

  const geminiKeysJoined = process.env.GEMINI_API_KEYS
    ?.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .join(",")
  const geminiApiKeys = geminiKeysJoined || ""
  const settings = {
    ...DEFAULT_SETTINGS,
    geminiApiKeys,
    embeddingBackend:
      process.env.SANCTUM_EMBED_BACKEND?.trim().toLowerCase() === "sentence-transformers"
        ? ("sentence-transformers" as const)
        : DEFAULT_SETTINGS.embeddingBackend,
  }
  const embeddingEnv = embeddingEnvFromProcess(process.env)
  const geminiBalancer = {
    hasKeys: geminiApiKeys.length > 0,
    embed: (text: string, model?: string, dims?: number) =>
      embedText(text, geminiApiKeys, model, dims),
  } as Pick<GeminiBalancer, "hasKeys" | "embed"> as GeminiBalancer

  server.registerTool(
    createQueryVaultTool({
      vault,
      createEmbedderForProject: (project: Project) =>
        createConfiguredEmbedderPort({
          settings,
          project,
          env: embeddingEnv,
          geminiBalancer,
        }),
    }),
  )

  const opencodeBaseUrl = process.env.OPENCODE_GO_BASE_URL ?? "https://api.opencode.ai/v1"
  const opencodeApiKey = (process.env.OPENCODE_GO_API_KEY ?? "").trim()
  const tracer = new TraceWriter(vault)
  log.info("opencode config", { hasKey: !!opencodeApiKey, baseUrl: opencodeBaseUrl })
  server.registerTool(createInvokeAgentTool(vault, opencodeBaseUrl, opencodeApiKey, tracer))
  server.registerTool(createRunMeshTool(vault, opencodeBaseUrl, opencodeApiKey, tracer))
  server.registerTool(createListNotesTool(vault))

  if (process.env.SANCTUM_MCP_HTTP === "1") {
    const token = (process.env.SANCTUM_MCP_TOKEN ?? "").trim()
    const allowedOrigins = parseAllowedOrigins(process.env.SANCTUM_MCP_ORIGINS)
    await startMcpHttp(server, {
      port: Number(process.env.SANCTUM_MCP_PORT || 8787) || 8787,
      host: "127.0.0.1",
      token,
      allowedOrigins,
    })
    log.info("sanctum mcp listo (http)", {
      port: process.env.SANCTUM_MCP_PORT || 8787,
      origins: allowedOrigins?.length ?? 0,
    })
  } else {
    server.start()
  }
}

main().catch((err) => {
  log.error("error fatal en main", { error: String(err) })
  process.exit(1)
})
