import type { ChainNode } from "../chains/types";

export interface ExecutionResult {
  nodeId: string;
  agentId: string;
  output: string;
  status: "ok" | "error";
  error?: string;
}

export const AGENT_TYPES = [
  { id: "forager",    name: "Forager",     icon: "search",        lucide: "search",      color: "#4caf7f", desc: "Recolecta y filtra fuentes del vault." },
  { id: "researcher", name: "Researcher",  icon: "book-open",     lucide: "book-open",   color: "#5b9bd5", desc: "Sintetiza e investiga en profundidad." },
  { id: "critic",     name: "Critic",      icon: "scale",         lucide: "scale",       color: "#e0a341", desc: "Revisa y cuestiona resultados." },
  { id: "web-search", name: "Web Search",  icon: "globe",         lucide: "globe",       color: "#8b7cf6", desc: "Busca info actualizada en web." },
  { id: "agente_base",name: "Agente Base", icon: "bot",           lucide: "bot",         color: "#9b9b9b", desc: "Responde usando contexto RAG." },
];

let _counter = 1;
export function genId(prefix: string): string { return `${prefix}${_counter++}`; }

export function getAgentById(id: string) { return AGENT_TYPES.find(a => a.id === id); }
