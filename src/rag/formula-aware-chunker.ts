/**
 * Markdown chunker that treats LaTeX and code regions as indivisible units.
 *
 * The indexer stores the returned strings verbatim, so this module deliberately
 * avoids normalising whitespace. A formula may make one chunk exceed the word
 * budget; splitting its delimiters would be worse for both retrieval and the
 * model that consumes the retrieved context.
 */

export const FORMULA_CHUNKER_VERSION = 2;

type RegionKind = "text" | "formula" | "code";

interface Region {
  kind: RegionKind;
  text: string;
}

const ENVIRONMENT_NAMES = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "aligned",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "split",
]);

function isEscaped(input: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function findClosingDelimiter(input: string, start: number, delimiter: string): number {
  let cursor = start;
  while (cursor < input.length) {
    const found = input.indexOf(delimiter, cursor);
    if (found < 0) return -1;
    if (!isEscaped(input, found)) return found;
    cursor = found + delimiter.length;
  }
  return -1;
}

function findEnvironmentEnd(input: string, start: number, name: string): number {
  const end = `\\end{${name}}`;
  const found = input.indexOf(end, start);
  return found < 0 ? -1 : found + end.length;
}

function readDelimitedRegion(input: string, start: number): { end: number; kind: RegionKind } | undefined {
  if (input.startsWith("$$", start)) {
    const close = findClosingDelimiter(input, start + 2, "$$");
    return close < 0 ? undefined : { end: close + 2, kind: "formula" };
  }
  if (input[start] === "$" && !isEscaped(input, start) && input[start + 1] !== "$") {
    const close = findClosingDelimiter(input, start + 1, "$");
    return close < 0 ? undefined : { end: close + 1, kind: "formula" };
  }
  for (const [open, close] of [["\\(", "\\)"], ["\\[", "\\]"]] as const) {
    if (input.startsWith(open, start)) {
      const end = findClosingDelimiter(input, start + open.length, close);
      return end < 0 ? undefined : { end: end + close.length, kind: "formula" };
    }
  }
  if (input.startsWith("\\begin{", start)) {
    const match = input.slice(start).match(/^\\begin\{([^}]+)\}/);
    const name = match?.[1];
    if (name && ENVIRONMENT_NAMES.has(name)) {
      const end = findEnvironmentEnd(input, start + match[0].length, name);
      return end < 0 ? undefined : { end, kind: "formula" };
    }
  }
  return undefined;
}

function scanRegions(input: string): Region[] {
  const regions: Region[] = [];
  let plainStart = 0;
  let cursor = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) regions.push({ kind: "text", text: input.slice(plainStart, end) });
  };

  while (cursor < input.length) {
    // Markdown fenced code is opaque: examples containing $ or \\begin must
    // not accidentally become mathematical regions.
    if (input.startsWith("```", cursor) && (cursor === 0 || input[cursor - 1] === "\n")) {
      const close = input.indexOf("\n```", cursor + 3);
      if (close >= 0) {
        flushPlain(cursor);
        const end = close + 4;
        regions.push({ kind: "code", text: input.slice(cursor, end) });
        cursor = end;
        plainStart = cursor;
        continue;
      }
    }
    if (input[cursor] === "`" && !isEscaped(input, cursor)) {
      const close = findClosingDelimiter(input, cursor + 1, "`");
      if (close >= 0) {
        flushPlain(cursor);
        regions.push({ kind: "code", text: input.slice(cursor, close + 1) });
        cursor = close + 1;
        plainStart = cursor;
        continue;
      }
    }

    const region = readDelimitedRegion(input, cursor);
    if (region) {
      flushPlain(cursor);
      regions.push({ kind: region.kind, text: input.slice(cursor, region.end) });
      cursor = region.end;
      plainStart = cursor;
      continue;
    }
    cursor++;
  }
  flushPlain(input.length);
  return regions;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function appendChunk(chunks: string[], value: string): void {
  const normalized = value.trim();
  if (normalized) chunks.push(normalized);
}

/** Split Markdown while keeping each formula/code region intact. */
export function chunkMarkdown(text: string, maxWords = 400): string[] {
  const limit = Number.isFinite(maxWords) && maxWords > 0 ? Math.floor(maxWords) : 400;
  const chunks: string[] = [];
  let current = "";
  let currentWords = 0;

  const flush = () => {
    appendChunk(chunks, current);
    current = "";
    currentWords = 0;
  };

  for (const region of scanRegions(text)) {
    if (region.kind === "formula" || region.kind === "code") {
      const regionWords = wordCount(region.text);
      if (currentWords > 0 && currentWords + regionWords > limit) flush();
      current += region.text;
      currentWords += regionWords;
      // An oversized atomic region is intentionally emitted as-is.
      if (currentWords > limit) flush();
      continue;
    }

    for (const token of region.text.match(/\s+|\S+/g) || []) {
      if (/^\s+$/.test(token)) {
        current += token;
        continue;
      }
      if (currentWords >= limit) flush();
      current += token;
      currentWords++;
    }
  }

  flush();
  return chunks.length ? chunks : [""];
}
