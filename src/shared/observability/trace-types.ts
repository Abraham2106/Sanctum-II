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

export function generateTraceId(): string {
  counter++;
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "-");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
  const id = counter.toString(36) + Math.random().toString(36).slice(2, 5);
  return `trace_${date}_${time}_${id}`;
}
