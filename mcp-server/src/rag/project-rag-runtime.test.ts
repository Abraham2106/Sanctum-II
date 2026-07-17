import { describe, expect, it } from "vitest"
import { ProjectRagRuntimeRegistry } from "./project-rag-runtime"

function projectFile(id: string): string {
  return `---\nid: ${id}\nname: ${id}\nread_paths: [\"Research\"]\nwrite_paths: []\nrag:\n  embed_model: gemini-embedding-2\n  dims: 768\n  chunk_words: 400\n---\n`
}

function memoryVault() {
  const files = new Map([
    ["sanctum-projects/default.md", projectFile("default")],
    ["sanctum-projects/explicit.md", projectFile("explicit")],
  ])
  return {
    read: async (path: string) => {
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" })
      return value
    },
    write: async (path: string, data: string) => { files.set(path, data) },
    mkdir: async () => {},
    list: async (path: string) => ({ files: [...files.keys()].filter(file => file.startsWith(`${path}/`)), folders: [] }),
    exists: async (path: string) => files.has(path) || path === "sanctum-projects",
  } as any
}

describe("ProjectRagRuntimeRegistry", () => {
  it("uses the configured project and lets an explicit argument override it", async () => {
    const registry = new ProjectRagRuntimeRegistry(memoryVault(), undefined, "default")
    await registry.initialize()
    expect((await registry.resolve()).projectId).toBe("default")
    expect((await registry.resolve("explicit")).projectId).toBe("explicit")
    registry.dispose()
  })

  it("rejects unsafe project identifiers before reading a project path", async () => {
    const registry = new ProjectRagRuntimeRegistry(memoryVault(), undefined)
    await registry.initialize()
    await expect(registry.resolve("../escape")).rejects.toThrow("INVALID_PROJECT_ID")
    registry.dispose()
  })
})
