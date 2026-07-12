export function globMatch(path: string, pattern: string): boolean {
  const p = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  if (p === "**" || p === "") return true;
  const regex = new RegExp(
    "^" + p
      .replace(/\*\*/g, "___DS___")
      .replace(/\*/g, "[^/]*")
      .replace(/___DS___/g, ".*")
      .replace(/\//g, "\\/")
      .replace(/\./g, "\\.")
  );
  return regex.test(path);
}

export function pathMatchesAny(filePath: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  if (patterns.includes("/**") || patterns.includes("**")) return true;
  return patterns.some(p => globMatch(filePath, p));
}

const SYSTEM_PREFIXES = ["sanctum-", "docs/"];

export function isInternalPath(filePath: string): boolean {
  const normalized = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return SYSTEM_PREFIXES.some(p => normalized.startsWith(p));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áä]/g, "a").replace(/[éë]/g, "e").replace(/[íï]/g, "i")
    .replace(/[óö]/g, "o").replace(/[úü]/g, "u").replace(/[ñ]/g, "n")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "nota";
}

export function extractTitle(content: string): string | null {
  const m = content.match(/^#\s+(.+)/m);
  return m ? m[1].trim() : null;
}
