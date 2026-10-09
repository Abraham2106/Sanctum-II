import { describe, expect, it } from "vitest";
import { criticAttemptDecision } from "./critic-decision";

describe("criticAttemptDecision (DEC-0022)", () => {
  it("empty object or empty evaluation → score 0, not accepted", () => {
    expect(criticAttemptDecision("{}")).toEqual({
      score: 0,
      verdict: "reject",
      accepted: false,
    });
    expect(criticAttemptDecision('{"evaluation":{}}')).toEqual({
      score: 0,
      verdict: "reject",
      accepted: false,
    });
  });

  it("total_score 90 without accept verdict → not accepted", () => {
    expect(
      criticAttemptDecision(JSON.stringify({ evaluation: { total_score: 90 } })),
    ).toEqual({ score: 90, verdict: "reject", accepted: false });
  });

  it("verdict accept with total_score below threshold → not accepted", () => {
    expect(
      criticAttemptDecision(
        JSON.stringify({ evaluation: { total_score: 10, verdict: "accept" } }),
      ),
    ).toEqual({ score: 10, verdict: "accept", accepted: false });
  });

  it("verdict accept with total_score at threshold → accepted", () => {
    expect(
      criticAttemptDecision(
        JSON.stringify({ evaluation: { total_score: 80, verdict: "accept" } }),
      ),
    ).toEqual({ score: 80, verdict: "accept", accepted: true });
  });

  it("verdict reject with total_score 90 → not accepted", () => {
    expect(
      criticAttemptDecision(
        JSON.stringify({ evaluation: { total_score: 90, verdict: "reject" } }),
      ),
    ).toEqual({ score: 90, verdict: "reject", accepted: false });
  });

  it("plain text without JSON → not accepted, score 0", () => {
    expect(criticAttemptDecision("no json here")).toEqual({
      score: 0,
      verdict: "reject",
      accepted: false,
    });
  });
});
