import { describe, expect, it } from "vitest";
import { parseCriticJSON } from "./parse";

describe("parseCriticJSON (DEC-0010)", () => {
  it("returns total_score 0 when total_score is absent", () => {
    const raw = JSON.stringify({
      evaluation: {
        criteria: [],
        threshold: 80,
        verdict: "accept",
        feedback_for_regeneration: [],
      },
    });
    const ev = parseCriticJSON(raw);
    expect(ev.total_score).toBe(0);
  });

  it("returns total_score 0 when total_score is a string", () => {
    const raw = JSON.stringify({
      evaluation: {
        total_score: "80",
        threshold: 80,
        verdict: "accept",
      },
    });
    const ev = parseCriticJSON(raw);
    expect(ev.total_score).toBe(0);
  });

  it("returns total_score 0 when total_score is NaN", () => {
    const raw = JSON.stringify({
      evaluation: {
        total_score: NaN,
        threshold: 80,
        verdict: "accept",
      },
    });
    const ev = parseCriticJSON(raw);
    expect(ev.total_score).toBe(0);
  });

  it("keeps numeric total_score 80", () => {
    const raw = JSON.stringify({
      evaluation: {
        total_score: 80,
        threshold: 80,
        verdict: "accept",
      },
    });
    const ev = parseCriticJSON(raw);
    expect(ev.total_score).toBe(80);
  });

  it("returns score 0 and verdict reject for plain text", () => {
    const ev = parseCriticJSON("esto no es JSON");
    expect(ev.total_score).toBe(0);
    expect(ev.verdict).toBe("reject");
  });

  it("defaults missing verdict to reject (DEC-0022)", () => {
    const raw = JSON.stringify({
      evaluation: {
        total_score: 95,
      },
    });
    const ev = parseCriticJSON(raw);
    expect(ev.verdict).toBe("reject");
  });

  it("defaults threshold to 80 when absent", () => {
    const raw = JSON.stringify({
      evaluation: {
        total_score: 75,
        verdict: "accept",
      },
    });
    const ev = parseCriticJSON(raw);
    expect(ev.threshold).toBe(80);
  });
});
