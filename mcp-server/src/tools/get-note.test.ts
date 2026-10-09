import { describe, expect, it } from "vitest"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { createGetNoteTool } from "./get-note.js"

const AGENT = `---
id: researcher
permissions:
  read_paths: [Research/**]
---
`

const PROJECT = `---
id: p1
name: P1
read_paths: [Research/]
---
`

function memoryVault(reads: Record<string, string>): VaultAdapter {
  return {
    read: async (p) => {
      if (!(p in reads)) throw new Error("ENOENT")
      return reads[p]
    },
    write: async () => {},
    mkdir: async () => {},
    list: async () => ({ files: [], folders: [] }),
    exists: async (p) => p in reads,
  }
}

describe("sanctum_get_note", () => {
  it("PROJECT_REQUIRED sin project_id ni env", async () => {
    const prev = process.env.SANCTUM_PROJECT_ID
    delete process.env.SANCTUM_PROJECT_ID
    const tool = createGetNoteTool(memoryVault({}))
    const result = await tool.handler({ agent_id: "researcher", path: "Research/a.md" })
    if (prev) process.env.SANCTUM_PROJECT_ID = prev
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Error: PROJECT_REQUIRED")
  })

  it("PERMISSION_DENIED cuando proyecto no cubre la ruta", async () => {
    const vault = memoryVault({
      "sanctum-agents/researcher.md": AGENT,
      "sanctum-projects/p1.md": PROJECT,
      "Other/x.md": "secret",
    })
    const tool = createGetNoteTool(vault)
    const result = await tool.handler({
      project_id: "p1",
      agent_id: "researcher",
      path: "Other/x.md",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/PERMISSION_DENIED/)
  })

  it("lee nota autorizada", async () => {
    const vault = memoryVault({
      "sanctum-agents/researcher.md": AGENT,
      "sanctum-projects/p1.md": PROJECT,
      "Research/a.md": "hola",
    })
    const tool = createGetNoteTool(vault)
    const result = await tool.handler({
      project_id: "p1",
      agent_id: "researcher",
      path: "Research/a.md",
    })
    expect(result.content[0].text).toContain("hola")
  })
})
