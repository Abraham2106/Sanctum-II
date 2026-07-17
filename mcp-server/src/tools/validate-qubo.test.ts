import { describe, expect, it } from "vitest"
import { createValidateQuboTool, validateQuboAgainstContext } from "./validate-qubo"

describe("sanctum_validate_qubo validation", () => {
  it("detects a binary versus spin convention mismatch", () => {
    const result = validateQuboAgainstContext({ expression: "Q(x) = x_1 + x_2", convention: "qubo" }, "Usamos espines s_i ∈ {-1,+1} y un Hamiltoniano Ising.")
    expect(result.issues.some(issue => issue.code === "SPIN_BINARY_CONVENTION_MISMATCH")).toBe(true)
  })

  it("flags an asymmetric Ising coupling matrix", () => {
    const result = validateQuboAgainstContext({ matrix: [[0, 1], [2, 0]], convention: "ising" }, "La formulación Ising usa spins ±1.")
    expect(result.issues.some(issue => issue.code === "ISING_MATRIX_ASYMMETRIC")).toBe(true)
  })

  it("reports documented normalization and coupling-sign conflicts", () => {
    const result = validateQuboAgainstContext({ expression: "H = +1 J_ij s_i s_j" }, "El acoplamiento J_ij es negativo antiferromagnético y el mapeo requiere factor 1/2.")
    expect(result.issues.some(issue => issue.code === "COUPLING_SIGN_MISMATCH")).toBe(true)
    expect(result.issues.some(issue => issue.code === "NORMALIZATION_MISSING")).toBe(true)
  })

  it("fails closed before accessing RAG when the agent has no read_paths", async () => {
    const vault = {
      read: async () => "---\nid: locked\npermissions:\n  read_paths: []\n---\nagent",
    } as any
    const store = { count: 1 } as any
    const tool = createValidateQuboTool(vault, store, "unused")
    const result = await tool.handler({ agent_id: "locked", formulation: [[0]] })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("PERMISSION_DENIED")
  })

  it("resolves the requested project only after read_paths authorization", async () => {
    const vault = {
      read: async () => "---\nid: allowed\npermissions:\n  read_paths: [\"Research/**\"]\n---\nagent",
    } as any
    let requestedProject: string | undefined
    const tool = createValidateQuboTool(vault, async projectId => {
      requestedProject = projectId
      return { store: { count: 0 } as any, projectId }
    }, "unused")
    const result = await tool.handler({ agent_id: "allowed", formulation: [[0]], project_id: "quantum" })
    expect(requestedProject).toBe("quantum")
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("VAULT_NOT_INDEXED")
  })
})
