import type { PendingAction } from "../projects/types";

const MAX_HISTORY_TOKENS = 4000; // rough limit before rolling summary
const SHORT_YES_NO = new Set(["si", "sí", "yes", "yep", "dale", "ok", "okay", "claro", "seguro", "hazlo", "adelante", "no", "nop", "no gracias", "para", "detente"]);

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ClassifiedIntent {
  type: "confirmation" | "rejection" | "new_query";
  message: string;
}

/** Classify short user messages as confirmation/rejection vs new query */
export function classifyIntent(userMsg: string, pendingAction?: PendingAction): ClassifiedIntent {
  const clean = userMsg.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!pendingAction) return { type: "new_query", message: userMsg };

  const isAffirmative = SHORT_YES_NO.has(clean) || clean === "si" || clean === "sí";
  const isNegative = clean === "no" || clean === "nop" || clean === "no gracias";

  if (isAffirmative) return { type: "confirmation", message: userMsg };
  if (isNegative) return { type: "rejection", message: userMsg };
  return { type: "new_query", message: userMsg };
}

/** Detect a pending action from the last assistant message */
export function detectPendingAction(assistantMsg: string): PendingAction | null {
  // Look for "¿Quieres que cree" / "¿Te gustaría que" patterns
  const createMatch = assistantMsg.match(/¿(quieres|te gustaría|deseas|puedo)\s+(que\s+)?(crear|crea|generar|genere|hacer|haga)\s+(una\s+)?nota\s+(llamada\s+)?["']?([^"'\n?]+)["']?/i);
  if (createMatch) {
    const noteName = (createMatch[5] || "nota sin título").trim();
    return {
      type: "create_note",
      description: `Crear nota "${noteName}"`,
      params: { noteName, fullProposal: assistantMsg.slice(0, 300) },
      proposed_at: Date.now(),
    };
  }

  // Look for "¿Quieres que busque / investigue / profundice?"
  const researchMatch = assistantMsg.match(/¿(quieres|te gustaría|deseas|puedo)\s+(que\s+)?(buscar|busque|investigar|investigue|profundizar|profundice|explorar|explore)\s+/i);
  if (researchMatch) return { type: "research", description: "Investigación adicional", params: { fullProposal: assistantMsg.slice(0, 300) }, proposed_at: Date.now() };

  return null;
}

/** Build the messages payload for the LLM, with rolling summary if needed */
export function buildConversationPayload(
  systemPrompt: string,
  messages: ConversationMessage[],
  summary?: string,
): { messages: ConversationMessage[]; newSummary?: string } {
  const payload: ConversationMessage[] = [];

  // System message
  payload.push({ role: "system", content: systemPrompt });

  // Rolling summary (if exists)
  if (summary) payload.push({ role: "system", content: `[Resumen de conversación anterior: ${summary}]` });

  // Recent messages (skip welcome/thinking messages)
  const relevant = messages.filter(m => m.content.length > 3 && !m.content.includes("Bienvenido a") && !m.content.includes("Pensando..."));

  // Estimate tokens: ~4 chars per token
  let estimatedTokens = systemPrompt.length / 4 + (summary?.length || 0) / 4;

  // Take from the end while under limit
  const recent: ConversationMessage[] = [];
  for (let i = relevant.length - 1; i >= 0; i--) {
    const tokens = relevant[i].content.length / 4;
    if (estimatedTokens + tokens > MAX_HISTORY_TOKENS) break;
    recent.unshift(relevant[i]);
    estimatedTokens += tokens;
  }

  // If we cut old messages, create/update summary
  let newSummary = summary || "";
  if (relevant.length > recent.length && recent.length > 0) {
    const cutMessages = relevant.slice(0, relevant.length - recent.length);
    const summaryText = cutMessages.map(m => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 150)}`).join("\n");
    newSummary = summaryText;
    // Replace the summary in the payload
    if (newSummary) {
      payload[1] = { role: "system", content: `[Resumen de conversación anterior: ${newSummary}]` };
    }
  }

  payload.push(...recent);
  return { messages: payload, newSummary };
}
