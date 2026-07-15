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

  constructor(
    private adapter: {
      read: (p: string) => Promise<string>;
      write: (p: string, content: string) => Promise<void>;
      exists: (p: string) => Promise<boolean>;
    }
  ) {}

  start(agentId: string, systemPrompt: string, userPrompt: string): string {
    const traceId = generateTraceId();
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

  addChunk(traceId: string, chunk: TraceChunk): void {
    const entry = this.traces.get(traceId);
    if (!entry?.trace.input) return;
    const exists = entry.trace.input.injected_context.some(
      c => c.chunk === chunk.chunk && c.from_note === chunk.from_note
    );
    if (!exists) {
      entry.trace.input.injected_context.push(chunk);
    }
  }

  async finish(traceId: string, output: string, loop_state?: Record<string, any>): Promise<void> {
    const entry = this.traces.get(traceId);
    if (!entry) return;
    entry.trace.output = output;
    entry.trace.duration_ms = Date.now() - entry.startTime;
    entry.trace.loop_state = loop_state;

    const recordId = entry.trace.trace_id!;
    const filePath = `${TRACES_DIR}/${recordId}.json`;

    try {
      const dirExists = await this.adapter.exists(TRACES_DIR).catch(() => false);
      if (!dirExists) {
        await this.adapter.write(`${TRACES_DIR}/.gitkeep`, "");
      }
      await this.adapter.write(filePath, JSON.stringify(entry.trace, null, 2));
    } catch (err: any) {
      console.warn("Sanctum tracer: no se pudo escribir trace:", err.message);
    }

    this.traces.delete(traceId);
  }

  abort(traceId: string, errorMessage: string): void {
    const entry = this.traces.get(traceId);
    if (entry) {
      entry.trace.output = `ERROR: ${errorMessage}`;
      entry.trace.duration_ms = Date.now() - entry.startTime;
    }
    this.finish(traceId, entry?.trace.output ?? `ERROR: ${errorMessage}`).catch((_err: any) => {});
  }
}
