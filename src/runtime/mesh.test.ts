import { describe, expect, it, vi } from "vitest";
import {
  normalizeMeshScore,
  passesAcceptGate,
  pickBestMeshAttempt,
  runMeshCore,
} from "./mesh";
import type { CriticEvaluation, MeshAttemptRecord } from "../shared/mesh/types";

function evaluation(overrides: Partial<CriticEvaluation> = {}): CriticEvaluation {
  return {
    criteria: [],
    total_score: 50,
    threshold: 80,
    verdict: "reject",
    feedback_for_regeneration: [],
    ...overrides,
  };
}

function criticJson(ev: Partial<CriticEvaluation>): string {
  return JSON.stringify({ evaluation: ev });
}

describe("passesAcceptGate (DEC-0022)", () => {
  it("requires explicit accept and score >= threshold", () => {
    expect(passesAcceptGate(evaluation({ total_score: 90, verdict: "accept" }), 80)).toBe(true);
    expect(passesAcceptGate(evaluation({ total_score: 90, verdict: "reject" }), 80)).toBe(false);
    expect(passesAcceptGate(evaluation({ total_score: 10, verdict: "accept" }), 80)).toBe(false);
  });

  it("rejects invalid or missing finite scores", () => {
    expect(normalizeMeshScore(Number.NaN)).toBeNull();
    expect(normalizeMeshScore(101)).toBeNull();
    expect(passesAcceptGate(evaluation({ total_score: Number.NaN, verdict: "accept" }), 80)).toBe(
      false,
    );
  });
});

describe("pickBestMeshAttempt", () => {
  it("keeps best score pair when later attempt is worse", () => {
    const attempts: MeshAttemptRecord[] = [
      { attempt: 1, output: "good", evaluation: evaluation({ total_score: 70 }), usage: { prompt: 0, completion: 0 } },
      { attempt: 2, output: "bad", evaluation: evaluation({ total_score: 50 }), usage: { prompt: 0, completion: 0 } },
    ];
    const best = pickBestMeshAttempt(attempts);
    expect(best?.output).toBe("good");
    expect(best?.evaluation.total_score).toBe(70);
  });
});

describe("runMeshCore (DEC-0022)", () => {
  const usage = { prompt: 1, completion: 1 };

  it("accepts when critic passes gate", async () => {
    const result = await runMeshCore(
      {
        runForager: async () => ({ content: "foraged", usage }),
        runResearcher: async () => ({ content: "research", usage }),
        runCritic: async () => ({
          content: criticJson({ total_score: 85, verdict: "accept" }),
          usage,
        }),
      },
      { userPrompt: "p", projectId: "proj" },
    );
    expect(result.status).toBe("accepted");
    expect(result.selectedAttempt?.output).toBe("research");
    expect(result.selectedAttempt?.score).toBe(85);
  });

  it("rejects high score without explicit accept verdict", async () => {
    const result = await runMeshCore(
      {
        runForager: async () => ({ content: "f", usage }),
        runResearcher: async () => ({ content: "r1", usage }),
        runCritic: async () => ({
          content: criticJson({ total_score: 95, verdict: "reject" }),
          usage,
        }),
        resolveOrchestratorAction: async () => "accept",
      },
      { userPrompt: "p", maxAttempts: 1 },
    );
    expect(result.status).toBe("needs_review");
    expect(result.selectedAttempt?.output).toBe("r1");
  });

  it("ends needs_review after max attempts without acceptance", async () => {
    let researcherCalls = 0;
    const result = await runMeshCore(
      {
        runForager: async () => ({ content: "f", usage }),
        runResearcher: async () => {
          researcherCalls += 1;
          return { content: `r${researcherCalls}`, usage };
        },
        runCritic: async () => {
          const score = 60 + researcherCalls;
          return {
            content: criticJson({
              total_score: score,
              verdict: "reject",
              feedback_for_regeneration: ["x"],
            }),
            usage,
          };
        },
      },
      { userPrompt: "p", maxAttempts: 3 },
    );
    expect(result.status).toBe("needs_review");
    expect(researcherCalls).toBe(3);
  });

  it("escalates when score at or below escalate threshold", async () => {
    const result = await runMeshCore(
      {
        runForager: async () => ({ content: "f", usage }),
        runResearcher: async () => ({ content: "r", usage }),
        runCritic: async () => ({
          content: criticJson({ total_score: 30, verdict: "reject" }),
          usage,
        }),
      },
      { userPrompt: "p", maxAttempts: 3 },
    );
    expect(result.status).toBe("escalated");
  });

  it("needs_review on score regression (no improvement)", async () => {
    let attempt = 0;
    const result = await runMeshCore(
      {
        runForager: async () => ({ content: "f", usage }),
        runResearcher: async () => ({ content: `r${++attempt}`, usage }),
        runCritic: async () => ({
          content: criticJson({
            total_score: attempt === 1 ? 55 : 50,
            verdict: "reject",
            feedback_for_regeneration: ["fix"],
          }),
          usage,
        }),
      },
      { userPrompt: "p", maxAttempts: 3 },
    );
    expect(result.status).toBe("needs_review");
    expect(result.selectedAttempt?.output).toBe("r1");
    expect(result.selectedAttempt?.score).toBe(55);
  });

  it("orchestrator accept cannot skip score gate", async () => {
    const result = await runMeshCore(
      {
        runForager: async () => ({ content: "f", usage }),
        runResearcher: async () => ({ content: "r", usage }),
        runCritic: async () => ({
          content: criticJson({ total_score: 50, verdict: "reject" }),
          usage,
        }),
        resolveOrchestratorAction: async () => "accept",
      },
      { userPrompt: "p", maxAttempts: 1 },
    );
    expect(result.status).toBe("needs_review");
  });

  it("respects cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    const result = await runMeshCore(
      {
        runForager: async (_p, signal) => {
          controller.abort();
          expect(signal?.aborted).toBe(true);
          throw new DOMException("Aborted", "AbortError");
        },
        runResearcher: async () => ({ content: "r", usage }),
        runCritic: async () => ({ content: criticJson({ total_score: 90, verdict: "accept" }), usage }),
      },
      { userPrompt: "p", signal: controller.signal },
    );
    expect(result.status).toBe("cancelled");
  });

  it("times out and clears timer", async () => {
    vi.useFakeTimers();
    const resultPromise = runMeshCore(
      {
        runForager: async (_p, signal) =>
          new Promise((resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
        runResearcher: async () => ({ content: "r", usage }),
        runCritic: async () => ({ content: criticJson({ total_score: 90, verdict: "accept" }), usage }),
      },
      { userPrompt: "p", timeoutMs: 50 },
    );
    await vi.advanceTimersByTimeAsync(60);
    const result = await resultPromise;
    vi.useRealTimers();
    expect(result.status).toBe("timed_out");
  });
});
