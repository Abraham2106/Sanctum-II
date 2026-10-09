import { describe, expect, it, vi } from "vitest"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { createQueryVaultTool } from "./query-vault.js"
import { writeGenerationArtifacts, type IndexGenerationMetadata } from "../../../src/projects/index-generations.js"
import { buildGeminiIdentity } from "../../../src/embeddings/embedding-identity.js"
import { chunkToSetLine } from "../../../src/rag/vector-store-encoding.js"
import type { Chunk } from "../../../src/rag/vector-store.js"
import type { EmbedderPort } from "../../../src/runtime/ports.js"

function memoryVault() {
  const dirs = new Set<string>()
  const files = new Map<string, string>()
  const ensureDir = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean)
    let cur = ""
    for (const p of parts.slice(0, -1)) {
      cur = cur ? `${cur}/${p}` : p
      dirs.add(cur)
    }
  }
  const adapter: VaultAdapter & { files: Map<string, string> } = {
    files,
    read: async (path: string) => {
      const v = files.get(path)
      if (v === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" })
      return v
    },
    write: async (path: string, content: string) => {
      ensureDir(path)
      files.set(path, content)
    },
    mkdir: async (path: string) => {
      dirs.add(path)
    },
    list: async (path: string) => {
      const prefix = path.replace(/\\/g, "/").replace(/\/$/, "")
      const fileOut: string[] = []
      const folderOut = new Set<string>()
      for (const key of files.keys()) {
        if (!key.startsWith(`${prefix}/`)) continue
        const rest = key.slice(prefix.length + 1)
        const slash = rest.indexOf("/")
        if (slash === -1) fileOut.push(key)
        else folderOut.add(`${prefix}/${rest.slice(0, slash)}`)
      }
      return { files: fileOut, folders: [...folderOut] }
    },
    exists: async (path: string) => dirs.has(path) || files.has(path),
    rename: async (oldPath: string, newPath: string) => {
      const content = files.get(oldPath)
      if (content === undefined) throw new Error("missing")
      files.delete(oldPath)
      files.set(newPath, content)
    },
  }
  return adapter
}

function sampleMetadata(projectId: string, generationId: string): IndexGenerationMetadata {
  const identity = buildGeminiIdentity("gemini-embedding-2", 2)
  return {
    version: 1,
    generationId,
    projectId,
    createdAt: new Date().toISOString(),
    indexFingerprint: "fp-test",
    chunkWords: 400,
    embedModel: "gemini-embedding-2",
    dims: 2,
    identity,
  }
}

function lineFor(notePath: string, text: string, embedding: number[]): string {
  const chunk: Chunk = {
    id: `c-${notePath}`,
    note_path: notePath,
    chunk_text: text,
    embedding,
  }
  return chunkToSetLine(chunk)
}

describe("sanctum_query_vault", () => {
  it("PROJECT_REQUIRED sin proyecto", async () => {
    const prev = process.env.SANCTUM_PROJECT_ID
    delete process.env.SANCTUM_PROJECT_ID
    const tool = createQueryVaultTool({
      vault: memoryVault(),
      createEmbedderForProject: () => ({ hasKeys: true, embed: vi.fn() }),
    })
    const result = await tool.handler({ agent_id: "a", query: "q" })
    if (prev) process.env.SANCTUM_PROJECT_ID = prev
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Error: PROJECT_REQUIRED")
  })

  it("filtra hermanos no autorizados antes del top-k", async () => {
    const vault = memoryVault()
    vault.files.set(
      "sanctum-projects/p1.md",
      `---
id: p1
read_paths: [Research/]
rag:
  embed_model: gemini-embedding-2
  dims: 2
  min_similarity: 0.5
---
`,
    )
    vault.files.set(
      "sanctum-agents/researcher.md",
      `---
id: researcher
permissions:
  read_paths: [Research/allowed.md]
---
`,
    )

    const vectorStore = [
      lineFor("Research/allowed.md", "visible", [1, 0]),
      lineFor("Research/sibling.md", "hidden sibling", [1, 0]),
    ].join("")

    await writeGenerationArtifacts(vault, "p1", "g1", {
      metadata: sampleMetadata("p1", "g1"),
      manifest: {},
      vectorStore,
      kgEdges: "",
    })

    const embed = vi.fn(async () => [1, 0])
    const port: EmbedderPort = { hasKeys: true, embed }
    const tool = createQueryVaultTool({
      vault,
      createEmbedderForProject: () => port,
    })

    const result = await tool.handler({
      project_id: "p1",
      agent_id: "researcher",
      query: "test",
    })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain("allowed.md")
    expect(result.content[0].text).not.toContain("sibling")
  })
})
