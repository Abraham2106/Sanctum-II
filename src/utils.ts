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
