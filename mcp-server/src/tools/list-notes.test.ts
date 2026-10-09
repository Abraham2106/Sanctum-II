import { describe, expect, it, vi } from "vitest"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { createListNotesTool } from "./list-notes.js"

const RESEARCHER_FM = `---
id: researcher
permissions:
  read_paths: ["/Research/**"]
  write_paths: []
---
body
`

const PROJECT_P1 = `---
id: p1
read_paths: [Research/]
---
`

function memoryVault(
  reads: Record<string, string>,
  lists: Record<string, { files: string[]; folders: string[] }>,
): VaultAdapter & { list: ReturnType<typeof vi.fn> } {
  const listFn = vi.fn(async (p: string) => {
    const entry = lists[p]
    if (!entry) throw new Error("ENOENT")
    return entry
  })
  return {
    read: async (p) => {
      if (!(p in reads)) throw new Error("ENOENT")
      return reads[p]
    },
    write: async () => {},
    mkdir: async () => {},
    list: listFn,
    exists: async (p) => p in reads,
  }
}

describe("sanctum_list_notes", () => {
  it("sin folder devuelve read_paths y no llama a list", async () => {
    const vault = memoryVault(
      {
        "sanctum-agents/researcher.md": RESEARCHER_FM,
        "sanctum-projects/p1.md": PROJECT_P1,
      },
      {},
    )
    const tool = createListNotesTool(vault)
    const result = await tool.handler({ agent_id: "researcher", project_id: "p1" })

    expect(vault.list).not.toHaveBeenCalled()
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain("Research")
  })

  it("lista un nivel en Research sin .txt ni sanctum-agents", async () => {
    const vault = memoryVault(
      {
        "sanctum-agents/researcher.md": RESEARCHER_FM,
        "sanctum-projects/p1.md": PROJECT_P1,
      },
      {
        Research: {
          files: ["Research/nota.md", "Research/readme.txt"],
          folders: ["Research/sub", "Research/sanctum-agents"],
        },
      },
    )
    const tool = createListNotesTool(vault)
    const result = await tool.handler({ agent_id: "researcher", project_id: "p1", folder: "Research" })

    expect(vault.list).toHaveBeenCalledWith("Research")
    expect(result.isError).toBeUndefined()
    const text = result.content[0].text
    expect(text).toContain("nota.md")
    expect(text).toContain("sub/")
    expect(text).not.toContain(".txt")
    expect(text).not.toContain("sanctum-agents")
  })

  it("folder fuera de read_paths es PERMISSION_DENIED", async () => {
    const vault = memoryVault(
      {
        "sanctum-agents/researcher.md": RESEARCHER_FM,
        "sanctum-projects/p1.md": PROJECT_P1,
      },
      { Other: { files: [], folders: [] } },
    )
    const tool = createListNotesTool(vault)
    const result = await tool.handler({ agent_id: "researcher", project_id: "p1", folder: "Other" })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Error: PERMISSION_DENIED")
  })

  it("folder ../x es PATH_DENIED y no llama a list", async () => {
    const vault = memoryVault(
      {
        "sanctum-agents/researcher.md": RESEARCHER_FM,
        "sanctum-projects/p1.md": PROJECT_P1,
      },
      {},
    )
    const tool = createListNotesTool(vault)
    const result = await tool.handler({ agent_id: "researcher", project_id: "p1", folder: "../x" })

    expect(vault.list).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/^Error: PATH_DENIED/)
  })

  it("filtra hijos no autorizados en la misma carpeta", async () => {
    const narrowAgent = `---
id: narrow
permissions:
  read_paths: [Research/ok.md]
---
`
    const vault = memoryVault(
      {
        "sanctum-agents/narrow.md": narrowAgent,
        "sanctum-projects/p1.md": PROJECT_P1,
      },
      {
        Research: {
          files: ["Research/ok.md", "Research/sibling.md"],
          folders: [],
        },
      },
    )
    const tool = createListNotesTool(vault)
    const result = await tool.handler({ agent_id: "narrow", project_id: "p1", folder: "Research" })
    expect(result.content[0].text).toContain("ok.md")
    expect(result.content[0].text).not.toContain("sibling")
  })
})
