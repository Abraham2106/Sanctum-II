import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import { VectorStore, type Chunk } from "../rag/vector-store";
import type { Project } from "./types";
import { isInternalPath } from "../utils";
import { ensureVaultDirectory } from "../core/vault-fs";

const CHUNK_MAX_WORDS = 400;

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h) + text.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}

function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += CHUNK_MAX_WORDS) {
    chunks.push(words.slice(i, i + CHUNK_MAX_WORDS).join(" "));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks;
}

export interface IndexResult {
  totalNotes: number;
  totalChunks: number;
  indexed: number;
  skipped: number;
  errors: string[];
}

export interface IndexOptions {
  /** Reindex only these paths while preserving manifest entries outside them. */
  paths?: string[];
}

const activeIndexJobs = new Map<string, Promise<IndexResult>>();

function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isWithinPath(filePath: string, directory: string): boolean {
  const file = cleanPath(filePath);
  const dir = cleanPath(directory);
  return file === dir || file.startsWith(`${dir}/`);
}

function isAllowedPath(candidate: string, allowed: string[]): boolean {
  return allowed.some(root => isWithinPath(candidate, root) || isWithinPath(root, candidate));
}

async function loadManifest(adapter: { read: (p: string) => Promise<string>; exists: (p: string) => Promise<boolean> }, projectId: string): Promise<Record<string, string>> {
  try {
    const path = `sanctum-logs/index/${projectId}/manifest.json`;
    if (await adapter.exists(path)) return JSON.parse(await adapter.read(path));
  } catch (err: any) { if (err) console.warn(`[Indexer] loadManifest ${projectId}:`, err.message); }
  return {};
}

async function saveManifest(adapter: { write: (p: string, c: string) => Promise<void> }, projectId: string, manifest: Record<string, string>): Promise<void> {
  await adapter.write(`sanctum-logs/index/${projectId}/manifest.json`, JSON.stringify(manifest, null, 2));
}

async function indexProjectInternal(
  adapter: {
    read: (p: string) => Promise<string>;
    list: (p: string) => Promise<{ files: string[]; folders: string[] }>;
    exists: (p: string) => Promise<boolean>;
    write: (p: string, c: string) => Promise<void>;
    mkdir: (p: string) => Promise<void>;
  },
  gemini: GeminiBalancer,
  project: Project,
  vectorStore: VectorStore,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const errors: string[] = [];
  let totalNotes = 0;
  let totalChunks = 0;
  let indexed = 0;
  let skipped = 0;

  await ensureVaultDirectory(adapter, `sanctum-logs/index/${project.id}`);

  console.log(`[KG] 📦 Indexando proyecto "${project.id}" → store: ${vectorStore.getStorePath()}`);
  console.log(`[KG] 📁 read_paths: ${JSON.stringify(project.read_paths)}`);

  const configuredPaths = (project.read_paths.length ? project.read_paths : ["Research"]).map(cleanPath);
  const targetPaths = (options.paths?.length ? options.paths : configuredPaths).map(cleanPath);
  if (options.paths?.length && !targetPaths.every(path => isAllowedPath(path, configuredPaths))) {
    return { totalNotes: 0, totalChunks: 0, indexed: 0, skipped: 0, errors: ["La carpeta solicitada está fuera de los read_paths del proyecto"] };
  }
  const allFiles: string[] = [];

  for (const targetPath of targetPaths) {
    const exists = await adapter.exists(targetPath).catch(() => false);
    if (!exists) {
      console.log(`[KG] ❌ Carpeta ${targetPath} no existe`);
      errors.push(`La carpeta ${targetPath} no existe`);
      continue;
    }
    const listing = await adapter.list(targetPath);
    const mdFiles = listing.files.filter((f) => f.endsWith(".md"));
    console.log(`[KG] 📂 ${targetPath}: ${mdFiles.length} archivos .md encontrados`);
    for (const f of mdFiles) {
      if (!allFiles.includes(f)) allFiles.push(f);
    }
  }
  console.log(`[KG] 📄 ${allFiles.length} archivos totales a procesar`);

  const manifest = await loadManifest(adapter, project.id);
  const partial = Boolean(options.paths?.length);
  const newManifest: Record<string, string> = partial ? { ...manifest } : {};
  const filesToPrune = new Set(
    Object.keys(manifest).filter(note => !partial || targetPaths.some(path => isWithinPath(note, path))),
  );

  for (const filePath of allFiles) {
    const noteName = filePath.replace(/\\/g, "/");
    filesToPrune.delete(noteName);

    if (isInternalPath(noteName)) {
      console.log(`[KG] ⏭ Saltando path interno: ${noteName}`);
      continue;
    }

    try {
      const content = await adapter.read(filePath);
      const hash = simpleHash(content);

      if (manifest[noteName] === hash) {
        newManifest[noteName] = hash;
        skipped++;
        continue;
      }

      const textChunks = chunkText(content);
      console.log(`[KG] 🔄 Indexando: ${noteName} (${textChunks.length} chunks)`);
      const newChunks: Chunk[] = [];
      for (let ci = 0; ci < textChunks.length; ci++) {
        const text = textChunks[ci];
        if (!text.trim()) continue;
        const embedding = await gemini.embed(text.slice(0, 3000));
        newChunks.push({
          id: `${noteName}#chunk-${ci}`,
          note_path: noteName,
          chunk_text: text,
          embedding,
        });
      }

      vectorStore.addChunks(newChunks, noteName);
      newManifest[noteName] = hash;
      totalChunks += newChunks.length;
      totalNotes++;
      indexed++;
    } catch (err: any) {
      errors.push(`${filePath}: ${err.message}`);
    }
  }

  // Prune deleted files from store
  for (const deletedPath of filesToPrune) {
    console.log(`[KG] 🗑 Pruneando: ${deletedPath}`);
    vectorStore.addChunks([], deletedPath);
  }

  await vectorStore.save(adapter);
  await saveManifest(adapter, project.id, newManifest);
  console.log(`[KG] ✅ Indexado: ${indexed} notas (${totalChunks} chunks), ${skipped} saltados, ${errors.length} errores → store count: ${vectorStore.count}`);
  if (errors.length) console.log(`[KG] ❌ Errores:`, errors);
  return { totalNotes, totalChunks, indexed, skipped, errors };
}

/** Runs one index operation per project, even when several UI surfaces trigger it. */
export function indexProject(
  adapter: Parameters<typeof indexProjectInternal>[0],
  gemini: GeminiBalancer,
  project: Project,
  vectorStore: VectorStore,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const existing = activeIndexJobs.get(project.id);
  if (existing) return existing;
  const job = indexProjectInternal(adapter, gemini, project, vectorStore, options);
  activeIndexJobs.set(project.id, job);
  return job.finally(() => {
    if (activeIndexJobs.get(project.id) === job) activeIndexJobs.delete(project.id);
  });
}
