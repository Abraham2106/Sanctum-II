import { describe, expect, it } from "vitest";
import { chainExecutionPathFilter, resolveComposerPathFilter } from "./chain-path-filter";

describe("chain-path-filter (T-043)", () => {
  it("empty folder selection does not widen scope with []", () => {
    expect(resolveComposerPathFilter("")).toBeUndefined();
    expect(resolveComposerPathFilter(null)).toBeUndefined();
    expect(resolveComposerPathFilter(undefined)).toBeUndefined();
    expect(chainExecutionPathFilter("")).toBeUndefined();
  });

  it("non-empty folder becomes a single glob subtree", () => {
    expect(resolveComposerPathFilter("Research/foo")).toEqual(["Research/foo/**"]);
  });
});
