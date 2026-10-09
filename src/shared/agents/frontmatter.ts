import { parse as parseYaml, stringify as stringifyYaml, YAMLError } from "yaml";

/** DEC-0022: explicit frontmatter failure codes for plugin and MCP. */
export type FrontmatterErrorCode =
  | "FRONTMATTER_BLOCK_MISSING"
  | "FRONTMATTER_YAML_INVALID"
  | "FRONTMATTER_NOT_OBJECT";

export class FrontmatterError extends Error {
  readonly code: FrontmatterErrorCode;

  readonly cause?: unknown;

  constructor(code: FrontmatterErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "FrontmatterError";
    this.code = code;
    this.cause = options?.cause;
  }
}

/** DEC-0022: strip UTF-8 BOM and normalize CRLF/CR to LF before parsing. */
export function normalizeDocumentText(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Parse a scalar using the same YAML rules as document frontmatter. */
export function parseScalar(value: string): any {
  const parsed = parseYaml(normalizeDocumentText(value).trim());
  return parsed === undefined ? "" : parsed;
}

/** Parse a complete YAML frontmatter block, including nested maps and sequences. */
export function parseFrontmatter(raw: string): Record<string, any> {
  const normalized = normalizeDocumentText(raw);
  let parsed: unknown;
  try {
    parsed = parseYaml(normalized);
  } catch (err) {
    const detail = err instanceof YAMLError ? err.message : String(err);
    throw new FrontmatterError(
      "FRONTMATTER_YAML_INVALID",
      `Frontmatter YAML inválido: ${detail}`,
      { cause: err },
    );
  }
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FrontmatterError(
      "FRONTMATTER_NOT_OBJECT",
      "Frontmatter YAML debe ser un mapa (objeto), no un escalar ni una secuencia.",
    );
  }
  return parsed as Record<string, any>;
}

/** Extract the frontmatter and Markdown body from a document. */
export function splitFrontmatter(markdown: string): { frontmatter: Record<string, any>; body: string } {
  const normalized = normalizeDocumentText(markdown);
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/);
  if (!match) {
    throw new FrontmatterError(
      "FRONTMATTER_BLOCK_MISSING",
      "Formato inválido: falta el bloque frontmatter ---",
    );
  }
  return { frontmatter: parseFrontmatter(match[1]), body: match[2].trim() };
}

/** Serialize frontmatter without inventing fields or YAML nesting conventions. */
export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  return stringifyYaml(frontmatter, { lineWidth: 0 }).trim();
}
