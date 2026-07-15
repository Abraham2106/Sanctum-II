import type { TraceChunk, TraceRecord } from "../shared/observability/trace-types";
export type { TraceChunk, TraceInput, TraceRecord } from "../shared/observability/trace-types";
import { generateTraceId } from "../shared/observability/trace-types";

const TRACES_DIR = "sanctum-logs/traces";

interface ActiveTrace {
  trace: Partial<TraceRecord>;
  startTime: number;
}

export class Tracer {
  private traces = new Map<string, ActiveTrace>();
  private currentId: string | null = null;

  constructor(
    private adapter: {
      read: (p: string) => Promise<string>;
      write: (p: string, content: string) => Promise<void>;
      exists: (p: string) => Promise<boolean>;
    }
  ) {}

  start(agentId: string, systemPrompt: string, userPrompt: string): string {
    if (this.currentId && this.traces.has(this.currentId)) {
      console.warn("[Tracer] starting new trace while previous is still active — auto-finishing previous");
      this.abort("overwritten_by_new_trace");
    }
    const traceId = generateTraceId();
    this.currentId = traceId;
    this.traces.set(traceId, {
      startTime: Date.now(),
      trace: {
        trace_id: traceId,
        timestamp: new Date().toISOString(),
        type: "agent_invocation",
        agent_id: agentId,
        input: {
          system_prompt: systemPrompt,
          user_prompt: userPrompt,
          injected_context: [],
        },
        output: "",
        duration_ms: 0,
      },
    });
    return traceId;
  }

  addChunk(chunk: TraceChunk): void {
    if (!this.currentId) return;
    const entry = this.traces.get(this.currentId);
    if (!entry?.trace.input) return;
    const exists = entry.trace.input.injected_context.some(
      c => c.chunk === chunk.chunk && c.from_note === chunk.from_note
    );
    if (!exists) {
      entry.trace.input.injected_context.push(chunk);
    }
  }

  async finish(output: string, loop_state?: Record<string, any>): Promise<void> {
    if (!this.currentId) return;
    const entry = this.traces.get(this.currentId);
    if (!entry) { this.currentId = null; return; }
    entry.trace.output = output;
    entry.trace.duration_ms = Date.now() - entry.startTime;
    entry.trace.loop_state = loop_state;

    const traceId = entry.trace.trace_id!;
    const filePath = `${TRACES_DIR}/${traceId}.json`;

    try {
      const dirExists = await this.adapter.exists(TRACES_DIR).catch(() => false);
      if (!dirExists) {
        await this.adapter.write(`${TRACES_DIR}/.gitkeep`, "");
      }
      await this.adapter.write(filePath, JSON.stringify(entry.trace, null, 2));
    } catch (err: any) {
      console.warn("Sanctum tracer: no se pudo escribir trace:", err.message);
    }

    this.traces.delete(this.currentId);
    this.currentId = null;
  }

  abort(errorMessage: string): void {
    if (!this.currentId) return;
    const entry = this.traces.get(this.currentId);
    if (entry) {
      entry.trace.output = `ERROR: ${errorMessage}`;
      entry.trace.duration_ms = Date.now() - entry.startTime;
    }
    this.finish(entry?.trace.output ?? `ERROR: ${errorMessage}`).catch((_err: any) => {});
  }
}
