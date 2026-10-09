import { describe, expect, it } from "vitest";
import { defaultProject } from "../projects/types";
import {
  buildEffectiveReadScope,
  filterAuthorizedPaths,
  isPathAuthorized,
  isValidPathPattern,
  normalizeProjectReadPattern,
  normalizeVaultPath,
} from "./permissions";

describe("permissions (DEC-0022)", () => {
  it("missing project denies", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: null,
      agentReadPaths: ["/**"],
    });
    expect(scope.allowed).toBe(false);
    expect(scope.reason).toBe("missing_project");
  });

  it("empty agent read_paths denies", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**"],
      agentReadPaths: [],
    });
    expect(scope.allowed).toBe(false);
    expect(scope.reason).toBe("empty_scope");
  });

  it("empty selection denies", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**"],
      agentReadPaths: ["/**"],
      selectionPaths: [],
    });
    expect(scope.allowed).toBe(false);
  });

  it("absent selection does not add a layer", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**"],
      agentReadPaths: ["/**"],
    });
    expect(scope.allowed).toBe(true);
    expect(scope.layers).toHaveLength(2);
  });

  it("malformed pattern denies", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["../escape/**"],
      agentReadPaths: ["/**"],
    });
    expect(scope.allowed).toBe(false);
    expect(scope.reason).toBe("malformed_pattern");
  });

  it("rejects control chars, drive paths, and double slashes in patterns", () => {
    expect(isValidPathPattern("/Research/")).toBe(true);
    expect(isValidPathPattern("/**")).toBe(true);
    expect(isValidPathPattern("Research//x/**")).toBe(false);
    expect(isValidPathPattern("C:/Research/**")).toBe(false);
    expect(isValidPathPattern("\x01bad/**")).toBe(false);
  });

  it("selection cannot expand project scope", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**"],
      agentReadPaths: ["/**"],
      selectionPaths: ["/**"],
    });
    expect(isPathAuthorized("Finanzas/secret.md", scope)).toBe(false);
    expect(isPathAuthorized("Research/note.md", scope)).toBe(true);
  });

  it("intersects disjoint agent and project to empty authorization", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Finanzas/**"],
      agentReadPaths: ["/Quantum/**"],
    });
    expect(scope.allowed).toBe(true);
    expect(isPathAuthorized("Finanzas/a.md", scope)).toBe(false);
    expect(isPathAuthorized("Quantum/a.md", scope)).toBe(false);
  });

  it("rejects malformed vault paths", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    expect(isPathAuthorized("../x.md", scope)).toBe(false);
    expect(isValidPathPattern("ok/**")).toBe(true);
  });

  it("filterAuthorizedPaths drops unauthorized notes", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**"],
      agentReadPaths: ["/**"],
    });
    expect(
      filterAuthorizedPaths(["Research/a.md", "Finanzas/b.md", "../bad.md"], scope),
    ).toEqual(["Research/a.md"]);
  });

  it("normalizeVaultPath rejects absolutes and drive paths", () => {
    expect(normalizeVaultPath("/Research/a.md")).toBeNull();
    expect(normalizeVaultPath("C:/Research/a.md")).toBeNull();
    expect(normalizeVaultPath("\\\\server\\share\\a.md")).toBeNull();
    expect(normalizeVaultPath("Research\\a.md")).toBeNull();
    expect(normalizeVaultPath("Research/../x.md")).toBeNull();
    expect(normalizeVaultPath("Research//a.md")).toBeNull();
    expect(normalizeVaultPath("Research/*/a.md")).toBeNull();
    expect(normalizeVaultPath("Research/a.md")).toBe("Research/a.md");
  });

  it("default project read_paths authorize subtree after normalization", () => {
    const project = defaultProject("demo");
    const scope = buildEffectiveReadScope({
      projectReadPaths: project.read_paths,
      agentReadPaths: ["/**"],
    });
    expect(isPathAuthorized("Research/note.md", scope)).toBe(true);
    expect(isPathAuthorized(`Projects/demo/nested.md`, scope)).toBe(true);
  });

  it("normalizeProjectReadPattern preserves globs for agent-style patterns", () => {
    expect(normalizeProjectReadPattern("/Research/**")).toBe("/Research/**");
    expect(normalizeProjectReadPattern("Projects/id")).toBe("/Projects/id/");
  });
});
