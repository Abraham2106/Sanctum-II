import type { AgentDefinition } from "../agents/types";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer } from "../observability/tracer";
import { renderSystemPrompt } from "../agents/agent-loader";

const MIN_SIMILARITY = 0.65;

export interface TurnDeps {
  agent: AgentDefinition;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  vectorStore: VectorStore;
  tracer: Tracer;
}

export interface TurnResult {
  content: string;
  usage: { prompt: number; completion: number };
  ragContext: string;
}

export async function executeTurn(
  deps: TurnDeps,
  userInput: string,
  skipRag: boolean = false,
  pathFilter?: string[]
): Promise<TurnResult> {
  let ragContext = "";
  if (!skipRag && deps.geminiBalancer.hasKeys && deps.vectorStore.count > 0) {
    const queryEmbedding = await deps.geminiBalancer.embed(userInput);
    let results = deps.vectorStore.search(queryEmbedding, 5).filter((r) => r.score >= MIN_SIMILARITY);
    if (pathFilter && pathFilter.length > 0) {
      results = deps.vectorStore.filterByPaths(results, pathFilter);
    } else if (deps.agent.permissions?.read_paths) {
      results = deps.vectorStore.filterByPaths(results, deps.agent.permissions.read_paths);
    }
    for (const r of results) {
      deps.tracer.addChunk({
        source: "rag",
        chunk: r.chunk.chunk_text,
        similarity_score: r.score,
        from_note: r.chunk.note_path,
      });
    }
    ragContext = results.map((r) => `[${r.chunk.note_path}]\n${r.chunk.chunk_text}`).join("\n\n");
  }

  const renderedPrompt = renderSystemPrompt(deps.agent, ragContext, userInput);
  const result = await deps.opencodeClient.chat(renderedPrompt, userInput, ragContext || undefined);

  return { content: result.content, usage: result.usage, ragContext };
}
