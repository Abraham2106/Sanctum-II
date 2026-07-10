import type { ChainNode } from "../chains/types";

export interface ExecutionResult {
  nodeId: string;
  agentId: string;
  output: string;
  status: "ok" | "error";
  error?: string;
}

export const AGENT_TYPES = [
  { id: "forager",    name: "Forager",     icon: "search",        lucide: "search",      color: "#5e9fe8", desc: "Recolecta y filtra fuentes del vault." },
  { id: "researcher", name: "Researcher",  icon: "book-open",     lucide: "book-open",   color: "#72bc8f", desc: "Sintetiza e investiga en profundidad." },
  { id: "critic",     name: "Critic",      icon: "scale",         lucide: "scale",       color: "#de9255", desc: "Revisa y cuestiona resultados." },
  { id: "web-search", name: "Web Search",  icon: "globe",         lucide: "globe",       color: "#4fb9c9", desc: "Busca info actualizada en web." },
  { id: "agente_base",name: "Agente Base", icon: "bot",           lucide: "bot",         color: "#bf8eda", desc: "Responde usando contexto RAG." },
];

let _counter = 1;
export function genId(prefix: string): string { return `${prefix}${_counter++}`; }

export function getAgentById(id: string) { return AGENT_TYPES.find(a => a.id === id); }
