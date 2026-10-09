import type { Chain, ChainEdge, ChainNode } from "./types";
import type { AgentDefinition } from "../agents/types";
import { executeTurn } from "../orchestrator/agent-turn";
import type { TurnDeps } from "../orchestrator/agent-turn";
import {
  DagValidationError,
  executeDag,
  stableTopologicalOrder,
  validateDag,
} from "../runtime/dag";

interface ExecutionResult {
  nodeId: string;
  agentId: string;
  output: string;
  usage: { prompt: number; completion: number };
}

/** Topological sort with strict validation (DEC-0022). */
export function topologicalOrder(nodes: ChainNode[], edges: ChainEdge[]): string[] {
  validateDag({ nodes, edges });
  return stableTopologicalOrder(nodes, edges);
}

export { DagValidationError };

export async function executeChain(
  chain: Chain,
  baseDeps: TurnDeps,
  getAgent: (agentId: string) => Promise<AgentDefinition>,
  userInput: string,
  pathFilter?: string[],
  signal?: AbortSignal,
): Promise<{ order: string[]; results: ExecutionResult[]; finalOutput: string }> {
  const agentByNode = new Map<string, string>();
  for (const node of chain.nodes) {
    agentByNode.set(node.id, node.agentId);
  }

  const dagResult = await executeDag({
    graph: { nodes: chain.nodes, edges: chain.edges },
    userMessage: userInput,
    projectId: chain.projectId,
    provenance: "sanctum.chain",
    agentIdForNode: (nodeId) => agentByNode.get(nodeId),
    signal,
    runNode: async (ctx) => {
      const node = chain.nodes.find((n) => n.id === ctx.nodeId);
      if (!node) {
        throw new Error(`Nodo no encontrado: ${ctx.nodeId}`);
      }
      const agent = await getAgent(node.agentId);
      const result = await executeTurn(
        { ...baseDeps, agent },
        ctx.userMessage,
        false,
        pathFilter,
      );
      return { output: result.content, usage: result.usage };
    },
  });

  if (dagResult.status === "failed" || dagResult.status === "cancelled") {
    throw new Error(dagResult.error ?? `Cadena ${dagResult.status}`);
  }

  const results: ExecutionResult[] = dagResult.results.map((row) => ({
    nodeId: row.nodeId,
    agentId: row.agentId ?? agentByNode.get(row.nodeId) ?? "",
    output: row.output,
    usage: row.usage,
  }));

  return { order: dagResult.order, results, finalOutput: dagResult.finalOutput };
}
