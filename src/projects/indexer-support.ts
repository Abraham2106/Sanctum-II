import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { KgEdge } from "../kg/types";
import type { EmbedCallOptions, EmbedderPort } from "../runtime/ports";
import { DEFAULT_PROJECT_RAG, type Project } from "./types";
import { isInternalPath } from "../utils";
import { sha256Hex, type IndexVaultAdapter } from "./index-generations-seal";

export function chunkWordsFor(project: Project): number {
  const n = project.rag?.chunk_words;
  return Number.isInteger(n) && n > 0 ? n! : DEFAULT_PROJECT_RAG.chunk_words;
}

export async function sha256NoteContent(text: string): Promise<string> {
  return sha256Hex(text);
}

export function chunkText(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks;
}

export type LegacyEmbedder = Pick<GeminiBalancer, "hasKeys" | "embed"> | {
  hasKeys?: boolean;
  embed: (text: string, model?: string, dims?: number) => Promise<number[]>;
};

export function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function isWithinPath(filePath: string, directory: string): boolean {
  const file = cleanPath(filePath);
  const dir = cleanPath(directory);
  return file === dir || file.startsWith(`${dir}/`);
}

export function isAllowedPath(candidate: string, allowed: string[]): boolean {
  return allowed.some((root) => isWithinPath(candidate, root));
}

export function toEmbedderPort(embedder: EmbedderPort | LegacyEmbedder): EmbedderPort {
  if (typeof (embedder as EmbedderPort).embed === "function") {
    const port = embedder as EmbedderPort;
    return {
      hasKeys: port.hasKeys,
      embed: (text, options) => port.embed(text, options),
    };
  }
  const legacy = embedder as LegacyEmbedder;
  return {
    hasKeys: legacy.hasKeys ?? true,
    embed: async (text, options?: EmbedCallOptions) => {
      const fn = legacy.embed;
      if (options?.model !== undefined) {
        return fn(text, options.model, options.expectedIdentity?.dims);
      }
      return fn(text);
    },
  };
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function wikilinkTargetToPath(target: string): string {
  const t = target.trim().replace(/\\/g, "/");
  if (!t || isInternalPath(t)) return "";
  if (t.endsWith(".md")) return t;
  return `${t}.md`;
}

export function extractExplicitEdges(content: string, sourcePath: string): KgEdge[] {
  const edges: KgEdge[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  WIKILINK.lastIndex = 0;
  while ((match = WIKILINK.exec(content)) !== null) {
    const targetPath = wikilinkTargetToPath(match[1]);
    if (!targetPath) continue;
    const key = [sourcePath, targetPath].sort().join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      from: sourcePath,
      to: targetPath,
      type: "explicit",
      weight: 1,
      relation: "wikilink",
    });
  }
  return edges;
}

export function filterKgEdgeEndpoints(edge: KgEdge, allowedRoots: string[]): boolean {
  return isAllowedPath(edge.from, allowedRoots) && isAllowedPath(edge.to, allowedRoots);
}

export async function listMarkdownRecursive(
  adapter: IndexVaultAdapter,
  root: string,
  allowedRoots: string[],
): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    const normalized = cleanPath(dir);
    if (!isAllowedPath(normalized, allowedRoots)) return;
    const listing = await adapter.list(normalized);
    for (const folder of listing.folders) {
      await walk(folder);
    }
    for (const file of listing.files) {
      if (file.endsWith(".md")) results.push(file.replace(/\\/g, "/"));
    }
  }
  await walk(root);
  return results;
}

export function newGenerationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
