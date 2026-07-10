import type { Chain, ChainEdge, ChainNode } from "./types";
import type { AgentDefinition } from "../agents/types";
import { executeTurn } from "../orchestrator/agent-turn";
import type { TurnDeps } from "../orchestrator/agent-turn";

interface ExecutionResult {
  nodeId: string;
  agentId: string;
  output: string;
  usage: { prompt: number; completion: number };
}

/** Topological sort of a directed graph. Returns node IDs in execution order. */
export function topologicalOrder(nodes: ChainNode[], edges: ChainEdge[]): string[] {
  const indeg: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  for (const n of nodes) { indeg[n.id] = 0; adj[n.id] = []; }
  for (const e of edges) {
    if (adj[e.from]) { adj[e.from].push(e.to); indeg[e.to] = (indeg[e.to] || 0) + 1; }
  }
  const q = nodes.filter(n => indeg[n.id] === 0).map(n => n.id);
  const seen = new Set<string>();
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const t of (adj[id] || [])) {
      indeg[t]--;
      if (indeg[t] <= 0) q.push(t);
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id);
  return order;
}

export async function executeChain(
  chain: Chain,
  baseDeps: TurnDeps,
  getAgent: (agentId: string) => Promise<AgentDefinition>,
  userInput: string,
  chatHistory?: any[],
): Promise<{ order: string[]; results: ExecutionResult[]; finalOutput: string }> {
  const order = topologicalOrder(chain.nodes, chain.edges);
  const results: ExecutionResult[] = [];
  let previousOutput = "";
  const scratchpad: Record<string, string> = {};

  for (const nodeId of order) {
    const node = chain.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    const agent = await getAgent(node.agentId);

    // Build context: project + chat + previous nodes
    let enrichedInput = userInput;
    if (Object.keys(scratchpad).length > 0) {
      const prevContext = Object.entries(scratchpad)
        .map(([nid, out]) => {
          const n = chain.nodes.find(x => x.id === nid);
          return `[${n?.agentId || nid}]: ${out.slice(0, 1000)}`;
        })
        .join("\n\n");
      enrichedInput = `${userInput}\n\n--- Contexto acumulado de la cadena ---\n${prevContext}`;
    }

    const result = await executeTurn(
      { ...baseDeps, agent },
      enrichedInput,
      false,
      [],
    );

    results.push({ nodeId, agentId: node.agentId, output: result.content, usage: result.usage });
    previousOutput = result.content;
    scratchpad[nodeId] = result.content;
  }

  const finalOutput = results.length > 0 ? results[results.length - 1].output : "";
  return { order, results, finalOutput };
}
