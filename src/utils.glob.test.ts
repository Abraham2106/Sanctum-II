import { describe, it, expect } from "vitest";
import { globMatch } from "./utils";

describe("globMatch (DEC-0009)", () => {
  it("rejects extension after .md in same segment", () => {
    expect(globMatch("Research/nota.md.exe", "Research/*.md")).toBe(false);
  });

  it("rejects trailing path after .md", () => {
    expect(globMatch("Research/nota.md/secret", "Research/*.md")).toBe(false);
  });

  it("rejects extra suffix on exact path pattern", () => {
    expect(globMatch("Research/a.md.secret", "Research/a.md")).toBe(false);
  });

  it("rejects nested path for single-segment star", () => {
    expect(globMatch("Research/sub/nota.md", "Research/*.md")).toBe(false);
  });

  it("matches single-segment star within one directory", () => {
    expect(globMatch("Research/nota.md", "Research/*.md")).toBe(true);
  });

  it("matches deep paths under **", () => {
    expect(globMatch("Research/a/b.md", "Research/**")).toBe(true);
  });

  it("strips leading slash on pattern", () => {
    expect(globMatch("Research/nota.md", "/Research/**")).toBe(true);
  });

  it("rejects paths outside ** prefix", () => {
    expect(globMatch("Finanzas/reporte.md", "Research/**")).toBe(false);
  });

  it("matches any path for lone **", () => {
    expect(globMatch("any/deep/path.md", "**")).toBe(true);
  });

  it("matches any path for empty pattern", () => {
    expect(globMatch("any.md", "")).toBe(true);
  });

  it("matches recursive md under Docs", () => {
    expect(globMatch("Docs/sub/a.md", "Docs/**/*.md")).toBe(true);
  });

  it("rejects non-md under recursive Docs pattern", () => {
    expect(globMatch("Docs/sub/a.txt", "Docs/**/*.md")).toBe(false);
  });
});
