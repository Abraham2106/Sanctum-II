import { parseCriticJSON } from "../shared/mesh/parse";
import { MESH_DEFAULTS } from "../shared/mesh/types";
import { passesAcceptGate } from "../runtime/mesh";

export function criticAttemptDecision(
  raw: string,
  threshold: number = MESH_DEFAULTS.ACCEPT_THRESHOLD,
): {
  score: number;
  verdict: "accept" | "reject";
  accepted: boolean;
} {
  const evaluation = parseCriticJSON(raw);
  return {
    score: evaluation.total_score,
    verdict: evaluation.verdict,
    accepted: passesAcceptGate(evaluation, threshold),
  };
}
