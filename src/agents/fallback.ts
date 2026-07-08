import type { AgentDefinition } from "./types";

export const FALLBACK_SYSTEM_PROMPT = `Eres un asistente que responde preguntas del usuario utilizando el contexto que se te provee del vault. Si el contexto no contiene información relevante, decilo explícitamente en vez de inventar.`;

export function fallbackAgent(): AgentDefinition {
  return {
    id: "fallback",
    name: "Fallback",
    avatar: "",
    model: "",
    description: "",
    triggers: [],
    tools: [],
    permissions: { read_paths: [], write_paths: [] },
    system_prompt: FALLBACK_SYSTEM_PROMPT,
  };
}
