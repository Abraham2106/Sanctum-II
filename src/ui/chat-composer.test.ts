import { describe, expect, it } from "vitest";
import { resolveComposerPathFilter } from "./chain-path-filter";

describe("composer path filter (T-043)", () => {
  it("maps empty select value to undefined path filter", () => {
    expect(resolveComposerPathFilter("")).toBeUndefined();
  });
});
