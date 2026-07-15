/**
 * Coerce a raw frontmatter value string to its proper type.
 * Handles arrays [...], booleans, numbers, and quoted/unquoted strings.
 */
export function parseScalar(value: string): any {
  value = value.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  if (value === "true" || value === "false") return value === "true";
  if (!isNaN(Number(value)) && value !== "") return Number(value);
  return value.replace(/^["']|["']$/g, "");
}

/**
 * Parse a YAML-like frontmatter block (key: value lines) into a Record.
 * Same logic used by agent-loader.ts, store.ts, permission-resolver.ts, and list-agents.ts.
 */
export function parseFrontmatter(raw: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    result[key] = parseScalar(value);
  }
  return result;
}
