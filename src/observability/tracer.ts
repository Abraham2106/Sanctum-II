export interface TraceChunk {
  source: "rag" | "kg";
  chunk: string;
  similarity_score: number;
  from_note: string;
  relation?: "wikilink" | "semantic" | "wikilink+semantic";
}

export interface TraceInput {
  system_prompt: string;
  user_prompt: string;
  injected_context: TraceChunk[];
}

export interface TraceRecord {
  trace_id: string;
  timestamp: string;
  type: string;
  agent_id: string;
  input: TraceInput;
  output: string;
  duration_ms: number;
  loop_state?: Record<string, any>;
}

let counter = 0;

function generateTraceId(): string {
  counter++;
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "-");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
  const id = counter.toString(36) + Math.random().toString(36).slice(2, 5);
  return `trace_${date}_${time}_${id}`;
}

const TRACES_DIR = "sanctum-logs/traces";

export class Tracer {
  private currentTrace: Partial<TraceRecord> | null = null;
  private startTime: number = 0;

  constructor(
    private adapter: {
      read: (p: string) => Promise<string>;
      write: (p: string, content: string) => Promise<void>;
      exists: (p: string) => Promise<boolean>;
    }
  ) {}

  start(agentId: string, systemPrompt: string, userPrompt: string): string {
    const traceId = generateTraceId();
    this.startTime = Date.now();
    this.currentTrace = {
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
    };
    return traceId;
  }

  addChunk(chunk: TraceChunk): void {
    if (this.currentTrace?.input) {
      const exists = this.currentTrace.input.injected_context.some(
        c => c.chunk === chunk.chunk && c.from_note === chunk.from_note
      );
      if (!exists) {
        this.currentTrace.input.injected_context.push(chunk);
      }
    }
  }

  async finish(output: string, loop_state?: Record<string, any>): Promise<void> {
    if (!this.currentTrace) return;
    this.currentTrace.output = output;
    this.currentTrace.duration_ms = Date.now() - this.startTime;
    this.currentTrace.loop_state = loop_state;

    const traceId = this.currentTrace.trace_id!;
    const filePath = `${TRACES_DIR}/${traceId}.json`;

    try {
      const dirExists = await this.adapter.exists(TRACES_DIR).catch(() => false);
      if (!dirExists) {
        await this.adapter.write(`${TRACES_DIR}/.gitkeep`, "");
      }
      await this.adapter.write(filePath, JSON.stringify(this.currentTrace, null, 2));
    } catch (err: any) {
      console.warn("Sanctum tracer: no se pudo escribir trace:", err.message);
    }

    this.currentTrace = null;
  }

  abort(errorMessage: string): void {
    if (!this.currentTrace) return;
    this.finish(`ERROR: ${errorMessage}`).catch(() => {});
  }
}
