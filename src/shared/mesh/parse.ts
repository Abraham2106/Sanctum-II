import type { CriticEvaluation, CriteriaScore, OrchestratorDecision, OrchestratorAction } from "./types";

/**
 * Parse the Critic agent's JSON output.
 * On failure, returns score 0 + verdict "reject" to force regeneration
 * rather than silently accepting 80 / "accept" (the old bug).
 */
export function parseCriticJSON(raw: string): CriticEvaluation {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON found");
    const jsonStr = raw.substring(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    const ev = parsed.evaluation || parsed;

    const criteria: CriteriaScore[] = [];
    if (Array.isArray(ev.criteria)) {
      for (const c of ev.criteria) {
        criteria.push({
          name: String(c.name ?? ""),
          score: typeof c.score === "number" ? c.score : 0,
          note: String(c.note ?? ""),
        });
      }
    }

    const totalScore = ev.total_score ?? 80;
    const threshold = ev.threshold ?? 80;
    const verdict = ev.verdict === "reject" ? ("reject" as const) : ("accept" as const);
    const feedback = Array.isArray(ev.feedback_for_regeneration) ? ev.feedback_for_regeneration : [];

    if (criteria.length === 0) {
      for (const name of ["coherencia_interna", "uso_de_fuentes", "completitud_vs_prompt", "actualidad_de_datos", "claridad_de_escritura"]) {
        const score = ev[name];
        if (typeof score === "number") {
          criteria.push({ name, score, note: "" });
        }
      }
    }

    return { criteria, total_score: totalScore, threshold, verdict, feedback_for_regeneration: feedback };
  } catch (err: any) {
    console.warn("Sanctum: fallo parseo de Critic JSON", err.message);
    return {
      criteria: [],
      total_score: 0,
      threshold: 80,
      verdict: "reject",
      feedback_for_regeneration: ["Error al parsear respuesta del Critic — se fuerza regeneración"],
    };
  }
}

/**
 * Parse the Orchestrator agent's decision from JSON.
 * Returns null if the output is unparseable (caller falls back to thresholds).
 */
export function parseOrchestratorDecision(raw: string): OrchestratorDecision | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const jsonStr = raw.substring(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    const action = parsed.action as string;
    if (action === "accept" || action === "escalate" || action === "regenerate") {
      return { action, reason: parsed.reason || "" };
    }
    return null;
  } catch {
    return null;
  }
}
