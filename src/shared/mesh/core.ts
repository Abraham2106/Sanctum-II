import type { CriticEvaluation, CriteriaScore, AttemptRecord, HistoryEntry, LoopState } from "./types";

export function buildResearcherInput(foragerOutput: string, history: HistoryEntry[], attempt: number): string {
  let input = foragerOutput;
  if (attempt > 1) {
    const criticEntries = history.filter(h => h.agent === "critic");
    if (criticEntries.length > 0) {
      input += `\n\n---\nFeedback del Critic para regeneración:\n`;
      for (const ce of criticEntries) {
        if (ce.feedback && ce.feedback.length > 0) {
          for (const fb of ce.feedback) {
            input += `- ${fb}\n`;
          }
        }
      }
      input += `\nPor favor, regenera tu respuesta teniendo en cuenta todo el feedback acumulado. Especialmente mejora los criterios con puntuación más baja.`;
    }
  }
  return input;
}

export function buildCriticInput(originalPrompt: string, researcherOutput: string): string {
  return `Prompt original del usuario:\n${originalPrompt}\n\nOutput del Researcher a evaluar:\n${researcherOutput}`;
}

export function buildOrchestratorInput(state: LoopState, evaluation: CriticEvaluation): string {
  const historySummary = state.history.map(h => {
    if (h.agent === "critic") {
      return `[${h.agent}] score=${h.score}, verdict=${h.verdict}, feedback=${JSON.stringify(h.feedback)}`;
    }
    return `[${h.agent}] output (first 200 chars): ${h.output.slice(0, 200)}`;
  }).join("\n");

  return `Loop state actual:
- original_prompt: "${state.original_prompt}"
- current_step: ${state.current_step}
- attempt: ${state.attempt} / max_attempts: ${state.max_attempts}

Historial del loop:
${historySummary}

Última evaluación del Critic:
- total_score: ${evaluation.total_score}
- threshold: ${evaluation.threshold}
- verdict: ${evaluation.verdict}
- criteria: ${JSON.stringify(evaluation.criteria.map(c => ({ name: c.name, score: c.score, note: c.note })))}
- feedback_for_regeneration: ${JSON.stringify(evaluation.feedback_for_regeneration)}
- best_total_score so far: ${state.attempts.length > 0 ? Math.max(...state.attempts.map(a => a.total_score)) : "N/A"}

Decidí el siguiente paso.`;
}

export function pickBestAttempt(state: LoopState): AttemptRecord | null {
  if (state.attempts.length === 0) return null;
  let best = state.attempts[0];
  for (const a of state.attempts) {
    if (a.total_score > best.total_score) best = a;
  }
  return best;
}

export function buildAttemptHistory(state: LoopState) {
  return state.attempts.map(a => ({
    attempt: a.attempt,
    total_score: a.total_score,
    criteria: a.criteria,
  }));
}
