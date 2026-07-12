import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { AgentDefinition } from "../agents/types";
import { renderSystemPrompt } from "../agents/agent-loader";
import { fallbackAgent } from "../agents/fallback";

const MIN_SIMILARITY = 0.65;

export async function testEmbeddings(balancer: GeminiBalancer): Promise<string> {
  if (!balancer.hasKeys) return "No hay GEMINI_API_KEYS configuradas";
  const vec = await balancer.embed("Hola mundo");
  return `Embedding OK — ${vec.length} dimensiones`;
}

export async function testChat(
  client: OpenCodeClient,
  agent: AgentDefinition | null,
): Promise<string> {
  if (!client.configured) return "OPENCODE_GO_API_KEY no configurada";
  const a = agent || fallbackAgent();
  const msg = "Decime solo 'Hola desde Sanctum II' en una línea.";
  const rendered = renderSystemPrompt(a, "", msg);
  const result = await client.chat(rendered, msg);
  return `Chat OK — ${result.usage.prompt}+${result.usage.completion} tokens`;
}

export async function ragQuery(
  balancer: GeminiBalancer,
  store: VectorStore,
  agent: AgentDefinition | null,
  query: string,
  pathFilter?: string[],
): Promise<string> {
  if (!balancer.hasKeys || store.count === 0) return "";
  try {
    const queryEmbedding = await balancer.embed(query);
    let results = store.search(queryEmbedding, 5).filter((r) => r.score >= MIN_SIMILARITY);
    const agentPerms = agent?.permissions?.read_paths;
    if (pathFilter && pathFilter.length > 0) {
      results = store.filterByPaths(results, pathFilter);
    }
    if (agentPerms && agentPerms.length > 0) {
      results = store.filterByPaths(results, agentPerms);
    }
    return results
      .map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(3)}) de ${r.chunk.note_path}:\n${r.chunk.chunk_text}`)
      .join("\n\n");
  } catch (err: any) {
    console.warn("Sanctum RAG error:", err.message);
    return "";
  }
}
