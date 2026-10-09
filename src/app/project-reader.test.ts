import { describe, expect, it, afterEach } from "vitest"
import {
  loadProject,
  ProjectRequiredError,
  resolveMcpProjectId,
} from "./project-reader"
import type { VaultAdapter } from "../core/vault-adapter"

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

describe("project-reader (DEC-0022)", () => {
  const prev = process.env.SANCTUM_PROJECT_ID

  afterEach(() => {
    if (prev === undefined) delete process.env.SANCTUM_PROJECT_ID
    else process.env.SANCTUM_PROJECT_ID = prev
  })

  it("resolveMcpProjectId usa argumento luego env", () => {
    process.env.SANCTUM_PROJECT_ID = "from-env"
    expect(resolveMcpProjectId({ project_id: "from-arg" })).toBe("from-arg")
    expect(resolveMcpProjectId({})).toBe("from-env")
  })

  it("sin project_id ni env lanza PROJECT_REQUIRED", () => {
    delete process.env.SANCTUM_PROJECT_ID
    expect(() => resolveMcpProjectId({})).toThrow(ProjectRequiredError)
  })

  it("loadProject valida id en disco", async () => {
    const vault = memoryVault({
      "sanctum-projects/demo.md": `---
id: demo
name: Demo
read_paths: [Research/]
---
`,
    })
    const p = await loadProject(vault, "demo")
    expect(p.id).toBe("demo")
    await expect(loadProject(vault, "missing")).rejects.toThrow(/PROJECT_NOT_FOUND/)
  })
})
