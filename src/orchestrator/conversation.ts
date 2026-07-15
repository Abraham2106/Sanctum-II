import type { PendingAction } from "../projects/types";

const MAX_HISTORY_TOKENS = 4000;
const SHORT_YES = new Set(["si", "sí", "yes", "yep", "dale", "ok", "okay", "claro", "seguro", "hazlo", "adelante"]);
const SHORT_NO = new Set(["no", "nop", "no gracias", "para", "detente"]);

/** Context captured when an assistant offers a follow-up action.  The source is
 * deliberately stored with the action: the next turn may be handled by a
 * different agent and the UI may only provide a truncated conversation. */
export interface PendingActionContext {
  sourceAgentId?: string;
  suggestedTitle?: string;
}

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
  const clean = normalizeForMatch(userMsg).replace(/[.!?]+$/, "").trim();
  if (!pendingAction) return { type: "new_query", message: userMsg };

  const isAffirmative = SHORT_YES.has(clean)
    || isCreateConfirmation(clean)
    || (pendingAction.type === "create_note" && isReferentialCreateConfirmation(clean));
  const isNegative = SHORT_NO.has(clean);

  if (isAffirmative) return { type: "confirmation", message: userMsg };
  if (isNegative) return { type: "rejection", message: userMsg };
  return { type: "new_query", message: userMsg };
}

/** Detect a pending action from the last assistant message */
export function detectPendingAction(assistantMsg: string, context?: PendingActionContext): PendingAction | null {
  const normalized = normalizeForMatch(assistantMsg);
  // Offers are normally in the closing paragraph. Restricting the search to
  // the tail avoids turning a quoted sentence in a long research response
  // into a pending action.
  const tail = normalized.slice(-2400);
  const createOffer = /\b(?:(?:si\s+)?(?:quieres|queres|deseas|te\s+gustaria)|puedo)\b[\s\S]{0,220}\b(?:crear|cree|crea|generar|genere|hacer|haga|guardar|guarde)\b[\s\S]{0,100}\bnota\b/i.test(tail);
  if (createOffer) {
    const noteName = extractNoteName(assistantMsg) || context?.suggestedTitle || extractHeading(assistantMsg) || "nota sin titulo";
    return {
      type: "create_note",
      description: `Crear nota "${noteName}"`,
      params: {
        noteName,
        suggestedTitle: noteName,
        // Keep the old field for compatibility, but preserve the complete
        // response for source-backed note generation.
        fullProposal: assistantMsg.slice(0, 300),
        sourceContent: assistantMsg,
        ...(context?.sourceAgentId ? { sourceAgentId: context.sourceAgentId } : {}),
        mode: "reformat_source",
      },
      proposed_at: Date.now(),
    };
  }

  // Look for "¿Quieres que busque / investigue / profundice?"
  const researchMatch = /¿?\s*(quieres|te\s+gustaria|deseas|puedo)\s+(que\s+)?(buscar|busque|investigar|investigue|profundizar|profundice|explorar|explore)\b/i.test(tail);
  if (researchMatch) return { type: "research", description: "Investigacion adicional", params: { fullProposal: assistantMsg.slice(0, 300) }, proposed_at: Date.now() };

  return null;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”„]/g, '"')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Â¿/g, "¿")
    .replace(/\s+/g, " ");
}

function isCreateConfirmation(clean: string): boolean {
  // Referential confirmations only. A message with an explicit subject (for
  // example, "crea una nota sobre X") remains a new query.
  return /^(?:genera(?:r)?|crea(?:r)?|haz(?:er)?|guarda(?:r)?)(?:\s+la)?\s+nota(?:\s+(?:a\s+partir\s+de\s+eso|anterior|mencionada|propuesta|completa|permanente))?$/.test(clean)
    || /^(?:genera|haz|guarda)$/.test(clean);
}

/**
 * A pending note offer can be confirmed with a complete instruction instead
 * of a short "sí". Keep this contextual to create_note actions so a request
 * such as "crea una nota sobre otro tema" remains a new query.
 */
function isReferentialCreateConfirmation(clean: string): boolean {
  const hasAction = /\b(?:crear?|generar?|hacer?|guardar?|escribir?)\b/.test(clean);
  const hasArtifact = /\b(?:nota|contenido|investigacion|respuesta|fuente)\b/.test(clean);
  const hasReference = /\b(?:eso|esta|este|anterior|previa|previo|a partir de|en el vault|del vault|contenido\s+(?:de|del|anterior|previo)|(?:la|esta|esa)\s+investigacion)\b/.test(clean);
  return hasAction && hasArtifact && hasReference;
}

function extractNoteName(message: string): string | null {
  const match = message.match(/\bnota\s+(?:llamada|titulada|denominada)\s+["']?([^"'\n?.!,]{2,120})["']?/i);
  return match?.[1]?.trim() || null;
}

function extractHeading(message: string): string | null {
  const match = message.match(/^\s*#\s+([^\n#]{2,120})/m);
  return match?.[1]?.trim() || null;
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
