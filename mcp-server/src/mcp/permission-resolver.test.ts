import { describe, expect, it } from "vitest"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { resolvePermissions } from "./permission-resolver.js"

function vault(reads: Record<string, string>): VaultAdapter {
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

describe("permission-resolver", () => {
  it("propaga error YAML con ruta del agente", async () => {
    const bad = `---
id: broken
permissions: [oops
---
`
    await expect(
      resolvePermissions(vault({ "sanctum-agents/broken.md": bad }), "broken"),
    ).rejects.toThrow(/sanctum-agents\/broken\.md:/)
  })

  it("rechaza agent id con traversal antes de leer", async () => {
    await expect(resolvePermissions(vault({}), "../x")).rejects.toThrow(/traversal/)
  })
})
