import { pathMatchesAny } from "../utils";

/** DEC-0022: portable read-scope intersection (project ∩ agent ∩ optional selection). */

export type PathPattern = string;

export type ReadScopeDenyReason =
  | "missing_project"
  | "empty_scope"
  | "malformed_pattern"
  | "malformed_path";

export interface ReadScopeInput {
  /** Absent or null project read scope denies all reads (fail-closed). */
  projectReadPaths: PathPattern[] | null | undefined;
  agentReadPaths?: PathPattern[] | undefined;
  /** Undefined = no extra restriction; [] = deny all. */
  selectionPaths?: PathPattern[] | undefined;
}

export interface EffectiveReadScope {
  allowed: boolean;
  /** Each layer must match at least one pattern; layers are intersected at path level. */
  layers: PathPattern[][];
  reason?: ReadScopeDenyReason;
}

const CONTROL_OR_WILDCARD = /[\x00-\x1f\x7f*?[\]{}]/;

/** DEC-0022: strict pattern validation; malformed patterns deny the whole scope. */
export function isValidPathPattern(pattern: string): boolean {
  if (typeof pattern !== "string") return false;
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (trimmed.includes("\\")) return false;
  if (trimmed.includes("..")) return false;
  return true;
}

/**
 * DEC-0022: project read_paths without globs become directory subtrees (/Research/, /Projects/id/).
 * Agent/selection patterns keep glob semantics unchanged.
 */
export function normalizeProjectReadPattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.includes("*") || trimmed.includes("?")) return trimmed;
  let body = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  if (!body || body.includes("..")) return trimmed;
  if (!body.endsWith("/")) body = `${body}/`;
  return `/${body}`;
}

function hasMalformedSegment(path: string): boolean {
  const segments = path.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") return true;
    if (CONTROL_OR_WILDCARD.test(seg)) return true;
  }
  return false;
}

function isAbsoluteOrDrivePath(path: string): boolean {
  if (path.startsWith("/")) return true;
  if (path.startsWith("\\\\") || path.startsWith("//")) return true;
  if (/^[a-zA-Z]:/.test(path)) return true;
  return false;
}

/** DEC-0022: normalize vault-relative paths; malformed paths are unauthorized (never strip absolutes). */
export function normalizeVaultPath(path: string): string | null {
  if (typeof path !== "string") return null;
  const p = path.trim();
  if (!p) return null;
  if (p.includes("\\")) return null;
  if (isAbsoluteOrDrivePath(p)) return null;
  if (p.includes("..")) return null;
  if (p.includes("//")) return null;
  if (hasMalformedSegment(p)) return null;
  return p;
}

function validateLayer(patterns: PathPattern[]): ReadScopeDenyReason | null {
  for (const pat of patterns) {
    if (!isValidPathPattern(pat)) return "malformed_pattern";
  }
  if (patterns.length === 0) return "empty_scope";
  return null;
}

function normalizeProjectLayer(patterns: PathPattern[]): PathPattern[] {
  return patterns.map((p) => normalizeProjectReadPattern(p));
}

/**
 * DEC-0022: build intersected read scope. Selection narrows project; it cannot widen project
 * because each layer must match (path-level intersection).
 */
export function buildEffectiveReadScope(input: ReadScopeInput): EffectiveReadScope {
  if (input.projectReadPaths == null) {
    return { allowed: false, layers: [], reason: "missing_project" };
  }

  const layers: PathPattern[][] = [];

  const projectErr = validateLayer(input.projectReadPaths);
  if (projectErr) return { allowed: false, layers: [], reason: projectErr };
  layers.push(normalizeProjectLayer(input.projectReadPaths));

  if (input.agentReadPaths !== undefined) {
    const agentErr = validateLayer(input.agentReadPaths);
    if (agentErr) return { allowed: false, layers: [], reason: agentErr };
    layers.push(input.agentReadPaths);
  }

  if (input.selectionPaths !== undefined) {
    const selErr = validateLayer(input.selectionPaths);
    if (selErr) return { allowed: false, layers: [], reason: selErr };
    layers.push(input.selectionPaths);
  }

  return { allowed: true, layers };
}

/** DEC-0022: authorize a note path against the effective scope before read/embed/KG/traces. */
export function isPathAuthorized(notePath: string, scope: EffectiveReadScope): boolean {
  if (!scope.allowed || scope.layers.length === 0) return false;
  const normalized = normalizeVaultPath(notePath);
  if (!normalized) return false;
  return scope.layers.every((layer) => pathMatchesAny(normalized, layer));
}

/** DEC-0022: filter note paths; drops malformed and unauthorized paths silently (no logging). */
export function filterAuthorizedPaths(notePaths: string[], scope: EffectiveReadScope): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of notePaths) {
    const norm = normalizeVaultPath(p);
    if (!norm || seen.has(norm)) continue;
    if (!isPathAuthorized(norm, scope)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}
