import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { log } from "../mcp/logger.js"

const TRACES_DIR = "sanctum-logs/traces"

function generateTraceId(): string {
  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const rand = Math.random().toString(36).slice(2, 6)
  return `trace_${ts}_${rand}`
}

export interface TraceRecord {
  trace_id: string
  timestamp: string
  type: "agent_invocation" | "mesh_run" | "rag_query" | "note_read"
  origin: "mcp"
  mcp_client?: string
  agent_id: string
  input: {
    system_prompt?: string
    user_prompt: string
    injected_context?: Array<{ source: string; chunk: string; similarity_score?: number; from_note?: string }>
  }
  output: string
  duration_ms: number
  loop_state?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export class TraceWriter {
  constructor(private vault: VaultAdapter) {}

  async writeTrace(record: Omit<TraceRecord, "trace_id" | "timestamp" | "origin">): Promise<string> {
    const trace: TraceRecord = {
      ...record,
      trace_id: generateTraceId(),
      timestamp: new Date().toISOString(),
      origin: "mcp",
    }

    const fileName = `${TRACES_DIR}/${trace.trace_id}.json`
    try {
      await this.vault.write(fileName, JSON.stringify(trace, null, 2))
      log.debug("trace escrito", { traceId: trace.trace_id, type: record.type })
    } catch (err) {
      log.error("fallo al escribir trace", { traceId: trace.trace_id, error: String(err) })
    }

    return trace.trace_id
  }
}
