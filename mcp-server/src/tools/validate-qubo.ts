import type { ToolDef } from "../mcp/types.js"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import type { RagRuntimeSource } from "../rag/runtime.js"
import { resolveRagRuntime } from "../rag/runtime.js"
import { log } from "../mcp/logger.js"
import { resolvePermissions } from "../mcp/permission-resolver.js"
import { embedText } from "../embeddings/gemini-embed.js"

export type QuboKind = "qubo" | "ising" | "unknown"

export interface QuboFormulation {
  matrix?: unknown
  expression?: string
  convention?: string
  encoding?: string
  offset?: number
}

export interface QuboIssue {
  code: string
  severity: "error" | "warning" | "info"
  message: string
  evidence?: string
}

export interface QuboValidation {
  kind: QuboKind
  convention: string
  issues: QuboIssue[]
}

function asFormulation(input: unknown): QuboFormulation {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input)
      if (parsed && typeof parsed === "object") return parsed as QuboFormulation
    } catch {
      return { expression: input }
    }
  }
  if (Array.isArray(input)) return { matrix: input }
  if (input && typeof input === "object") return input as QuboFormulation
  return {}
}

function matrixOf(input: unknown): number[][] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined
  if (!input.every(row => Array.isArray(row))) return undefined
  const matrix = input.map(row => (row as unknown[]).map(value => Number(value)))
  if (!matrix.every(row => row.every(value => Number.isFinite(value)))) return undefined
  return matrix
}

function detectKind(formulation: QuboFormulation, expression: string): QuboKind {
  const explicit = `${formulation.convention ?? ""} ${formulation.encoding ?? ""} ${expression}`.toLowerCase()
  if (/ising|spin|s[_\s]?\{?i|\+?\/[-−]?1|±\s*1/.test(explicit)) return "ising"
  if (/qubo|binary|boolean|0\s*[,/]\s*1|x[_\s]?i/.test(explicit) || formulation.matrix !== undefined) return "qubo"
  return "unknown"
}

function contextKind(context: string): QuboKind {
  const lower = context.toLowerCase()
  const hasIsing = /ising|spin|s[_\s]?i|\+?\s*[-−]\s*1|±\s*1/.test(lower)
  const hasQubo = /qubo|binary|0\s*[,/]\s*1|x[_\s]?i/.test(lower)
  if (hasIsing && !hasQubo) return "ising"
  if (hasQubo && !hasIsing) return "qubo"
  return "unknown"
}

function matrixIssues(matrixInput: unknown, kind: QuboKind, context: string): QuboIssue[] {
  const issues: QuboIssue[] = []
  if (!Array.isArray(matrixInput)) return issues
  const matrix = matrixOf(matrixInput)
  if (!matrix) {
    issues.push({ code: "MATRIX_INVALID", severity: "error", message: "La matriz debe ser cuadrada y contener únicamente números finitos." })
    return issues
  }
  if (!matrix.every(row => row.length === matrix.length)) {
    issues.push({ code: "MATRIX_NOT_SQUARE", severity: "error", message: "La matriz de la formulación no es cuadrada." })
    return issues
  }
  let symmetric = true
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > 1e-9) symmetric = false
    }
  }
  if (kind === "ising" && !symmetric) {
    issues.push({ code: "ISING_MATRIX_ASYMMETRIC", severity: "error", message: "Una matriz Ising de acoplamientos debe ser simétrica: Jᵢⱼ = Jⱼᵢ." })
  }
  if (kind === "qubo" && symmetric && /upper[- ]triangular|off[- ]diagonal[^.\n]{0,40}(once|una sola vez)/i.test(context)) {
    issues.push({ code: "QUBO_OFFDIAGONAL_CONVENTION", severity: "warning", message: "La matriz es simétrica, pero el contexto describe una convención triangular superior; los términos fuera de diagonal podrían estar contándose dos veces." })
  }
  return issues
}

function normalizationIssues(formulationText: string, context: string): QuboIssue[] {
  const issues: QuboIssue[] = []
  const contextHalf = /(?:factor|normalizaci[oó]n|normalization|mapeo|mapping)[^\n.]{0,100}(?:1\s*\/\s*2|0\.5|½)/i.test(context)
  const contextQuarter = /(?:factor|normalizaci[oó]n|normalization|mapeo|mapping)[^\n.]{0,100}(?:1\s*\/\s*4|0\.25|¼)/i.test(context)
  const proposedHalf = /(?:1\s*\/\s*2|0\.5|½)/.test(formulationText)
  const proposedQuarter = /(?:1\s*\/\s*4|0\.25|¼)/.test(formulationText)
  if (contextHalf && !proposedHalf && !proposedQuarter) {
    issues.push({ code: "NORMALIZATION_MISSING", severity: "warning", message: "El contexto RAG documenta un factor 1/2 (o 0.5), pero la formulación no lo declara.", evidence: "factor 1/2" })
  }
  if (contextQuarter && !proposedQuarter && !proposedHalf) {
    issues.push({ code: "NORMALIZATION_MISSING", severity: "warning", message: "El contexto RAG documenta un factor 1/4 (o 0.25), pero la formulación no lo declara.", evidence: "factor 1/4" })
  }
  return issues
}

function signIssues(formulationText: string, context: string): QuboIssue[] {
  const issues: QuboIssue[] = []
  const proposedPositive = /(?:\+\s*(?:\d+(?:\.\d+)?\s*)?(?:J|Q)|(?:J|Q)\s*[_\{]?i[^\n=]{0,20}=\s*\+)/i.test(formulationText)
  const proposedNegative = /(?:-\s*(?:\d+(?:\.\d+)?\s*)?(?:J|Q)|(?:J|Q)\s*[_\{]?i[^\n=]{0,20}=\s*-)/i.test(formulationText)
  const contextAntiferro = /(?:J|acoplamiento|coupling)[^\n.]{0,100}(?:antiferromagn|negative|negativo|<\s*0)/i.test(context)
  const contextFerro = /(?:J|acoplamiento|coupling)[^\n.]{0,100}(?:ferromagn|positive|positivo|>\s*0)/i.test(context)
  if (proposedPositive && contextAntiferro) {
    issues.push({ code: "COUPLING_SIGN_MISMATCH", severity: "error", message: "La formulación propone un acoplamiento positivo, pero las notas/papers describen Jᵢⱼ como negativo o antiferromagnético." })
  }
  if (proposedNegative && contextFerro) {
    issues.push({ code: "COUPLING_SIGN_MISMATCH", severity: "error", message: "La formulación propone un acoplamiento negativo, pero las notas/papers describen Jᵢⱼ como positivo o ferromagnético." })
  }
  return issues
}

export function validateQuboAgainstContext(input: unknown, context: string): QuboValidation {
  const formulation = asFormulation(input)
  const expression = String(formulation.expression ?? "")
  const kind = detectKind(formulation, expression)
  const issues: QuboIssue[] = []
  const documentedKind = contextKind(context)
  if (kind === "unknown") {
    issues.push({ code: "CONVENTION_UNCLEAR", severity: "warning", message: "No se pudo determinar si la formulación usa QUBO binario (0/1) o Ising de espines (±1)." })
  } else if (documentedKind !== "unknown" && documentedKind !== kind) {
    issues.push({ code: "SPIN_BINARY_CONVENTION_MISMATCH", severity: "error", message: `La formulación parece ${kind.toUpperCase()}, pero el contexto RAG usa la convención ${documentedKind.toUpperCase()}.`, evidence: context.slice(0, 240) })
  }
  issues.push(...matrixIssues(formulation.matrix, kind, context))
  issues.push(...normalizationIssues(`${expression} ${JSON.stringify(formulation.matrix ?? "")}`, context))
  issues.push(...signIssues(expression, context))
  return {
    kind,
    convention: kind === "ising" ? "spin ±1" : kind === "qubo" ? "binary 0/1" : "unknown",
    issues,
  }
}

export function createValidateQuboTool(vault: VaultAdapter, ragSource: RagRuntimeSource, geminiApiKey: string | undefined): ToolDef {
  return {
    name: "sanctum_validate_qubo",
    description: "Valida una formulación QUBO/Ising contra contexto RAG permitido, detectando convenciones spin ±1 vs 0/1, signos de acoplamiento, simetría y normalización.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Agente cuya lista read_paths autoriza el contexto RAG." },
        formulation: { description: "Expresión, matriz cuadrada o objeto {matrix, expression, convention, encoding, offset}." },
        context_query: { type: "string", description: "Consulta adicional para recuperar las notas/papers relevantes." },
        max_results: { type: "number", description: "Máximo de chunks RAG (default 5, máximo 20)." },
        project_id: { type: "string", description: "Proyecto RAG opcional. Precedencia: argumento, SANCTUM_PROJECT_ID, indice global legacy." },
      },
      required: ["agent_id", "formulation"],
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim()
      if (!agentId) throw new Error("'agent_id' es obligatorio")
      if (args.formulation === undefined || args.formulation === null) throw new Error("'formulation' es obligatorio")
      const perms = await resolvePermissions(vault, agentId)
      if (!perms.readPaths.length) {
        log.warn("qubo validation blocked: empty read_paths", { agentId })
        return { content: [{ type: "text", text: "Error: PERMISSION_DENIED - El agente no tiene read_paths para consultar contexto RAG." }], isError: true }
      }
      const runtime = await resolveRagRuntime(ragSource, String(args.project_id ?? "").trim() || undefined)
      const store = runtime.store
      if (store.count === 0) {
        return { content: [{ type: "text", text: "Error: VAULT_NOT_INDEXED - No hay chunks RAG indexados." }], isError: true }
      }
      if (!geminiApiKey) {
        return { content: [{ type: "text", text: "Error: GEMINI_NOT_CONFIGURED - No hay GEMINI_API_KEYS configuradas." }], isError: true }
      }
      const query = `${String(args.context_query ?? "").trim()}\nFormulación QUBO/Ising:\n${typeof args.formulation === "string" ? args.formulation : JSON.stringify(args.formulation)}`.trim()
      const limit = typeof args.max_results === "number" && args.max_results > 0 ? Math.min(Math.floor(args.max_results), 20) : 5
      const embedding = await embedText(query, geminiApiKey)
      const candidates = store.search(embedding, Math.max(limit * 4, 20))
        .filter(result => result.score >= 0.65)
      const permitted = store.filterByPaths(candidates, perms.readPaths).slice(0, limit)
      const context = permitted.map(result => result.chunk.chunk_text).join("\n\n")
      const validation = validateQuboAgainstContext(args.formulation, context)
      if (!context) validation.issues.push({ code: "RAG_CONTEXT_INSUFFICIENT", severity: "warning", message: "No se recuperó contexto permitido con similitud suficiente; la validación solo cubre invariantes estructurales." })
      log.info("sanctum_validate_qubo", { agentId, projectId: runtime.projectId, permitted: permitted.length, issueCount: validation.issues.length, kind: validation.kind })
      return {
        content: [{ type: "text", text: JSON.stringify({ ...validation, sources: permitted.map(result => ({ note_path: result.chunk.note_path, similarity: result.score })) }, null, 2) }],
      }
    },
  }
}
