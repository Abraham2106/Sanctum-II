/**
 * DEC-0022: portable DAG validation and sequential execution (no provider I/O here).
 */

export interface DagNodeRef {
  id: string;
}

export interface DagEdgeRef {
  id?: string;
  from: string;
  to: string;
}

export interface DagGraph {
  nodes: DagNodeRef[];
  edges: DagEdgeRef[];
}

export class DagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DagValidationError";
  }
}

export type DagRunStatus = "completed" | "failed" | "cancelled";

export interface DagNodeRunResult {
  nodeId: string;
  agentId?: string;
  output: string;
  usage: { prompt: number; completion: number };
}

export interface DagTerminalOutput {
  nodeId: string;
  agentId?: string;
  output: string;
}

export interface DagExecutionResult {
  status: DagRunStatus;
  order: string[];
  results: DagNodeRunResult[];
  terminalOutputs: DagTerminalOutput[];
  finalOutput: string;
  projectId: string;
  provenance: string;
  error?: string;
}

export interface DagRunNodeContext {
  nodeId: string;
  agentId?: string;
  userMessage: string;
  predecessorOutputs: Array<{ nodeId: string; agentId?: string; output: string }>;
}

export type DagNodeRunner = (ctx: DagRunNodeContext) => Promise<{
  output: string;
  usage: { prompt: number; completion: number };
}>;

/** Validate node ids, edge endpoints, duplicate edges, and cycles before any provider call. */
export function validateDag(graph: DagGraph): void {
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    const id = node.id?.trim();
    if (!id) {
      throw new DagValidationError("Nodo sin id válido");
    }
    if (nodeIds.has(id)) {
      throw new DagValidationError(`Id de nodo duplicado: ${id}`);
    }
    nodeIds.add(id);
  }

  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.id?.trim()) {
      const eid = edge.id.trim();
      if (edgeIds.has(eid)) {
        throw new DagValidationError(`Id de arista duplicado: ${eid}`);
      }
      edgeIds.add(eid);
    }

    const from = edge.from?.trim();
    const to = edge.to?.trim();
    if (!from || !to) {
      throw new DagValidationError("Arista con from/to vacío");
    }
    if (!nodeIds.has(from)) {
      throw new DagValidationError(`Arista referencia nodo inexistente (from): ${from}`);
    }
    if (!nodeIds.has(to)) {
      throw new DagValidationError(`Arista referencia nodo inexistente (to): ${to}`);
    }

    const pairKey = `${from}\0${to}`;
    if (edgePairs.has(pairKey)) {
      throw new DagValidationError(`Arista duplicada: ${from} -> ${to}`);
    }
    edgePairs.add(pairKey);
  }

  stableTopologicalOrder(graph.nodes, graph.edges);
}

/** Stable topological order; throws DagValidationError on cycle. */
export function stableTopologicalOrder(nodes: DagNodeRef[], edges: DagEdgeRef[]): string[] {
  const indexOf = new Map<string, number>();
  nodes.forEach((n, i) => indexOf.set(n.id, i));

  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const e of edges) {
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  for (const [id, list] of adj) {
    list.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));
  }

  const ready: string[] = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));
    const id = ready.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const nextDeg = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, nextDeg);
      if (nextDeg === 0) {
        ready.push(next);
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new DagValidationError("Ciclo detectado en el DAG");
  }

  return order;
}

function directPredecessors(nodeId: string, edges: DagEdgeRef[]): string[] {
  return edges.filter((e) => e.to === nodeId).map((e) => e.from);
}

function terminalNodeIds(nodes: DagNodeRef[], edges: DagEdgeRef[]): string[] {
  const hasOutgoing = new Set(edges.map((e) => e.from));
  return nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id);
}

function buildNodeInput(
  userMessage: string,
  preds: Array<{ nodeId: string; agentId?: string; output: string }>,
): string {
  if (preds.length === 0) {
    return userMessage;
  }
  const sections = preds
    .map((p) => `[${p.agentId ?? p.nodeId}]: ${p.output}`)
    .join("\n\n");
  return `${userMessage}\n\n--- Contexto de nodos predecesores ---\n${sections}`;
}

export function formatTerminalFinalOutput(terminals: DagTerminalOutput[]): string {
  if (terminals.length === 0) {
    return "";
  }
  if (terminals.length === 1) {
    return terminals[0].output;
  }
  return terminals.map((t) => `## ${t.nodeId}\n${t.output}`).join("\n\n");
}

export async function executeDag(params: {
  graph: DagGraph;
  userMessage: string;
  projectId: string;
  provenance: string;
  agentIdForNode?: (nodeId: string) => string | undefined;
  runNode: DagNodeRunner;
  signal?: AbortSignal;
}): Promise<DagExecutionResult> {
  validateDag(params.graph);

  const order = stableTopologicalOrder(params.graph.nodes, params.graph.edges);
  const outputs = new Map<string, string>();
  const results: DagNodeRunResult[] = [];

  const abortIfNeeded = () => {
    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  };

  try {
    for (const nodeId of order) {
      abortIfNeeded();
      const predIds = directPredecessors(nodeId, params.graph.edges);
      const predecessorOutputs = predIds.map((pid) => ({
        nodeId: pid,
        agentId: params.agentIdForNode?.(pid),
        output: outputs.get(pid) ?? "",
      }));

      const ctx: DagRunNodeContext = {
        nodeId,
        agentId: params.agentIdForNode?.(nodeId),
        userMessage: params.userMessage,
        predecessorOutputs,
      };

      const enriched = buildNodeInput(ctx.userMessage, predecessorOutputs);
      const run = await params.runNode({ ...ctx, userMessage: enriched });
      outputs.set(nodeId, run.output);
      results.push({
        nodeId,
        agentId: ctx.agentId,
        output: run.output,
        usage: run.usage,
      });
    }

    const terminalIds = terminalNodeIds(params.graph.nodes, params.graph.edges);
    const terminalOrder = order.filter((id) => terminalIds.includes(id));
    const terminalOutputs: DagTerminalOutput[] = terminalOrder.map((id) => {
      const row = results.find((r) => r.nodeId === id)!;
      return { nodeId: id, agentId: row.agentId, output: row.output };
    });

    return {
      status: "completed",
      order,
      results,
      terminalOutputs,
      finalOutput: formatTerminalFinalOutput(terminalOutputs),
      projectId: params.projectId,
      provenance: params.provenance,
    };
  } catch (err: unknown) {
    const isAbort =
      err instanceof DOMException && err.name === "AbortError" ||
      (err instanceof Error && err.name === "AbortError");
    const terminalIds = terminalNodeIds(params.graph.nodes, params.graph.edges);
    const terminalOrder = order.filter((id) => terminalIds.includes(id));
    const terminalOutputs: DagTerminalOutput[] = terminalOrder
      .filter((id) => outputs.has(id))
      .map((id) => {
        const row = results.find((r) => r.nodeId === id);
        return { nodeId: id, agentId: row?.agentId, output: outputs.get(id) ?? "" };
      });

    return {
      status: isAbort ? "cancelled" : "failed",
      order,
      results,
      terminalOutputs,
      finalOutput: formatTerminalFinalOutput(terminalOutputs),
      projectId: params.projectId,
      provenance: params.provenance,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
