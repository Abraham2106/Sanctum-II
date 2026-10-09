export function criticAttemptDecision(raw: string): {
  score: number;
  verdict: "accept" | "reject";
  accepted: boolean;
} {
  // DEC-0014: sin score ni accept explícito la cadena no aprueba
  let score = 0;
  let verdict: "accept" | "reject" = "reject";

  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end >= start) {
      const json = JSON.parse(raw.substring(start, end + 1));
      const ev = json.evaluation || json;

      const ts = ev.total_score;
      if (typeof ts === "number" && Number.isFinite(ts)) {
        score = ts;
      }

      if (ev.verdict === "accept") {
        verdict = "accept";
      } else if (ev.verdict === "reject") {
        verdict = "reject";
      }
    }
  } catch {
    // missing or invalid JSON → reject, score 0
  }

  const accepted = score >= 80 || verdict === "accept";
  return { score, verdict, accepted };
}
