import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Parse a scalar using the same YAML rules as document frontmatter. */
export function parseScalar(value: string): any {
  const parsed = parseYaml(value.trim());
  return parsed === undefined ? "" : parsed;
}

/** Parse a complete YAML frontmatter block, including nested maps and sequences. */
export function parseFrontmatter(raw: string): Record<string, any> {
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, any>;
}

/** Extract the frontmatter and Markdown body from a document. */
export function splitFrontmatter(markdown: string): { frontmatter: Record<string, any>; body: string } {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error("Formato inválido: falta el bloque frontmatter ---");
  return { frontmatter: parseFrontmatter(match[1]), body: match[2].trim() };
}

/** Serialize frontmatter without inventing fields or YAML nesting conventions. */
export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  return stringifyYaml(frontmatter, { lineWidth: 0 }).trim();
}
