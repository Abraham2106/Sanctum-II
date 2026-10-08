import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "./vector-store";

describe("cosineSimilarity (DEC-0015)", () => {
  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
    expect(cosineSimilarity([1], [1, 0])).toBe(0);
  });

  it("returns 0 when any component is not finite", () => {
    expect(cosineSimilarity([1, 0], [1, NaN])).toBe(0);
  });

  it("preserves standard cosine results for valid vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
