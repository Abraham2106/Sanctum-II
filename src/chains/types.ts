export interface ChainNode {
  id: string;
  agentId: string;
  x: number;
  y: number;
  label?: string;
}

export interface ChainEdge {
  id: string;
  from: string;
  to: string;
}

export interface Chain {
  id: string;
  name: string;
  invocation: string;
  description: string;
  projectId: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  defaultForProject: boolean;
}

export function defaultChain(id: string, projectId: string): Chain {
  return {
    id,
    name: id,
    invocation: `@${id}`,
    description: "",
    projectId,
    nodes: [],
    edges: [],
    defaultForProject: false,
  };
}
