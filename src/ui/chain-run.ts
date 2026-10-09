import type { Chain } from "../chains/types";
import { executeChain } from "../chains/executor";
import type { TurnDeps } from "../orchestrator/agent-turn";
import { executeDag, type DagExecutionResult } from "../runtime/dag";
import { loadAgentFromVault } from "../agents/agent-loader";
import { executeTurn } from "../orchestrator/agent-turn";
import type { VaultAdapter } from "../core/vault-adapter";

export type ChainRunOutcome = DagExecutionResult;

/** Re-export shared chain executor entry point for completed runs. */
export { executeChain };

/**
 * Same sequential executeTurn wiring as executeChain (DEC-0022), with DAG outcomes for partial/cancel UI.
 */
export async function runChainForView(
  chain: Chain,
  baseDeps: TurnDeps,
  vaultAdapter: VaultAdapter,
  userInput: string,
  pathFilter: string[] | undefined,
  signal?: AbortSignal,
): Promise<ChainRunOutcome> {
  const agentByNode = new Map<string, string>();
  for (const node of chain.nodes) agentByNode.set(node.id, node.agentId);

  return executeDag({
    graph: { nodes: chain.nodes, edges: chain.edges },
    userMessage: userInput,
    projectId: chain.projectId,
    provenance: "sanctum.chain",
    agentIdForNode: (nodeId) => agentByNode.get(nodeId),
    signal,
    runNode: async (ctx) => {
      const node = chain.nodes.find((n) => n.id === ctx.nodeId);
      if (!node) throw new Error(`Nodo no encontrado: ${ctx.nodeId}`);
      const agent = await loadAgentFromVault(vaultAdapter, `${node.agentId}.md`);
      const result = await executeTurn(
        { ...baseDeps, agent, signal },
        ctx.userMessage,
        false,
        pathFilter,
      );
      return { output: result.content, usage: result.usage };
    },
  });
}
