import { VectorStore, type Chunk } from "../rag/vector-store";
import type { Project } from "./types";
import { isInternalPath, pathMatchesAny } from "../utils";
import { ensureVaultDirectory } from "../core/vault-fs";
import { chunkMarkdown, FORMULA_CHUNKER_VERSION } from "../rag/formula-aware-chunker";
import { sha256Hex } from "../rag/fingerprint";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export const INDEX_MANIFEST_SCHEMA_VERSION = 2;
export const chunkText = chunkMarkdown;

export interface IndexManifestDocument {
  path: string;
  content_hash: string;
  config_fingerprint: string;
  chunk_hashes: string[];
  indexed_at: number;
}

export interface IndexManifestV2 {
  schema_version: 2;
  documents: Record<string, IndexManifestDocument>;
}

export type IndexChange =
  | { type: "upsert"; path: string }
  | { type: "delete"; path: string }
  | { type: "rename"; oldPath: string; path: string };

export interface IndexResult {
  totalNotes: number;
  totalChunks: number;
  indexed: number;
  skipped: number;
  reusedEmbeddings: number;
  generatedEmbeddings: number;
  errors: string[];
}

export interface IndexOptions {
  /** Reindex only these directories while preserving entries outside them. */
  paths?: string[];
  /** Apply exact file changes without scanning a directory. */
  changes?: IndexChange[];
}

interface IndexAdapter {
  read(path: string): Promise<string>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

const projectIndexChains = new Map<string, Promise<unknown>>();

function emptyResult(): IndexResult {
  return { totalNotes: 0, totalChunks: 0, indexed: 0, skipped: 0, reusedEmbeddings: 0, generatedEmbeddings: 0, errors: [] };
}

function isEmbeddingExhaustedError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("se agotaron")
    || lower.includes("cooldown")
    || lower.includes("quota")
    || lower.includes("rate limit")
    || lower.includes("resource_exhausted");
}

function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function rootDirectory(path: string): string {
  return cleanPath(path).replace(/\/\*\*?$/, "").replace(/^\*\*?$/, "") || ".";
}

function isWithinPath(filePath: string, directory: string): boolean {
  const file = cleanPath(filePath);
  const dir = rootDirectory(directory);
  if (dir === ".") return true;
  return file === dir || file.startsWith(`${dir}/`);
}

function canTraverseDirectory(path: string): boolean {
  const normalized = cleanPath(path);
  if (!normalized || normalized === ".") return true;
  if (isInternalPath(normalized)) return false;
  const segments = normalized.toLowerCase().split("/");
  return !segments.some(segment => segment === ".git" || segment === ".obsidian" || segment === "node_modules");
}

export function isProjectPathAllowed(filePath: string, project: Pick<Project, "read_paths">): boolean {
  if (isInternalPath(filePath) || !filePath.toLowerCase().endsWith(".md")) return false;
  return project.read_paths.some(pattern => pattern.includes("*")
    ? pathMatchesAny(filePath, [pattern])
    : isWithinPath(filePath, pattern));
}

function blankManifest(): IndexManifestV2 {
  return { schema_version: INDEX_MANIFEST_SCHEMA_VERSION, documents: {} };
}

export function parseIndexManifest(raw: string): { manifest: IndexManifestV2; migrated: boolean } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schema_version === INDEX_MANIFEST_SCHEMA_VERSION && parsed.documents && typeof parsed.documents === "object") {
      return { manifest: parsed as IndexManifestV2, migrated: false };
    }
    // Legacy manifests were maps of path -> short content hash. They cannot
    // prove which model/chunker produced the vectors, so one rebuild is safer.
    if (parsed && typeof parsed === "object") return { manifest: blankManifest(), migrated: true };
  } catch {}
  return { manifest: blankManifest(), migrated: false };
}

async function loadManifest(adapter: Pick<IndexAdapter, "read" | "exists">, projectId: string): Promise<{ manifest: IndexManifestV2; migrated: boolean }> {
  const path = `sanctum-logs/index/${projectId}/manifest.json`;
  try {
    if (await adapter.exists(path)) return parseIndexManifest(await adapter.read(path));
  } catch (error: any) {
    console.warn(`[Indexer] loadManifest ${projectId}:`, error?.message || error);
  }
  return { manifest: blankManifest(), migrated: false };
}

async function saveManifest(adapter: Pick<IndexAdapter, "write">, projectId: string, manifest: IndexManifestV2): Promise<void> {
  await adapter.write(`sanctum-logs/index/${projectId}/manifest.json`, JSON.stringify(manifest, null, 2));
}

async function projectConfigFingerprint(project: Project): Promise<string> {
  return sha256Hex(JSON.stringify({
    embed_model: project.rag?.embed_model || "gemini-embedding-2",
    dims: project.rag?.dims || 768,
    chunk_words: project.rag?.chunk_words || 400,
    chunker_version: FORMULA_CHUNKER_VERSION,
  }));
}

async function chunkFingerprint(configFingerprint: string, text: string): Promise<string> {
  return sha256Hex(`${configFingerprint}\0${text}`);
}

async function buildEmbeddingCache(
  store: VectorStore,
  manifest: IndexManifestV2,
  configFingerprint: string,
): Promise<Map<string, number[]>> {
  const cache = new Map<string, number[]>();
  for (const chunk of store.allChunks) {
    const document = manifest.documents[chunk.note_path];
    if (!document || document.config_fingerprint !== configFingerprint) continue;
    cache.set(await chunkFingerprint(configFingerprint, chunk.chunk_text), chunk.embedding);
  }
  return cache;
}

function coalesceChanges(changes: IndexChange[]): Map<string, "upsert" | "delete"> {
  const result = new Map<string, "upsert" | "delete">();
  for (const change of changes) {
    if (change.type === "rename") {
      result.set(cleanPath(change.oldPath), "delete");
      result.set(cleanPath(change.path), "upsert");
    } else {
      result.set(cleanPath(change.path), change.type);
    }
  }
  return result;
}

async function collectFiles(
  adapter: IndexAdapter,
  project: Project,
  options: IndexOptions,
): Promise<{ files: string[]; deletes: Set<string>; partial: boolean; errors: string[] }> {
  const errors: string[] = [];
  const deletes = new Set<string>();
  if (options.changes?.length) {
    const operations = coalesceChanges(options.changes);
    const files: string[] = [];
    for (const [path, operation] of operations) {
      const allowed = isProjectPathAllowed(path, project);
      if (!allowed && operation === "upsert") {
        errors.push(`La nota ${path} está fuera de los read_paths del proyecto`);
        continue;
      }
      if (operation === "delete") deletes.add(path);
      else files.push(path);
    }
    return { files, deletes, partial: true, errors };
  }

  const configuredRoots = (project.read_paths.length ? project.read_paths : ["Research"]).map(rootDirectory);
  const targetRoots = (options.paths?.length ? options.paths : configuredRoots).map(rootDirectory);
  if (options.paths?.length && !targetRoots.every(path => project.read_paths.some(root => isWithinPath(path, root) || isWithinPath(root, path)))) {
    return { files: [], deletes, partial: true, errors: ["La carpeta solicitada está fuera de los read_paths del proyecto"] };
  }
  const files: string[] = [];
  for (const target of targetRoots) {
    if (!await adapter.exists(target).catch(() => false)) {
      errors.push(`La carpeta ${target} no existe`);
      continue;
    }
    const directories = [target];
    const visited = new Set<string>();
    while (directories.length) {
      const directory = directories.shift()!;
      if (visited.has(directory)) continue;
      visited.add(directory);
      const listing = await adapter.list(directory);
      for (const folder of listing.folders) {
        const normalizedFolder = cleanPath(folder);
        if (canTraverseDirectory(normalizedFolder)) directories.push(normalizedFolder);
      }
      for (const file of listing.files) {
        const normalized = cleanPath(file);
        if (isProjectPathAllowed(normalized, project) && !files.includes(normalized)) files.push(normalized);
      }
    }
  }
  return { files, deletes, partial: Boolean(options.paths?.length), errors };
}

async function indexProjectInternal(
  adapter: IndexAdapter,
  embeddings: EmbeddingProvider,
  project: Project,
  vectorStore: VectorStore,
  options: IndexOptions,
): Promise<IndexResult> {
  const result = emptyResult();
  await ensureVaultDirectory(adapter, `sanctum-logs/index/${project.id}`);

  const loaded = await loadManifest(adapter, project.id);
  const manifest = loaded.manifest;
  const configFingerprint = await projectConfigFingerprint(project);
  const collected = await collectFiles(adapter, project, options);
  result.errors.push(...collected.errors);
  const seen = new Set(collected.files);

  if (!collected.partial) {
    const knownPaths = new Set([...Object.keys(manifest.documents), ...vectorStore.allChunks.map(chunk => chunk.note_path)]);
    for (const path of knownPaths) if (!seen.has(path)) collected.deletes.add(path);
  }

  // Capture reusable vectors before applying tombstones so a pure rename can
  // move unchanged content without calling the embedding provider again.
  const embeddingCache = await buildEmbeddingCache(vectorStore, manifest, configFingerprint);
  for (const deletedPath of collected.deletes) {
    vectorStore.addChunks([], deletedPath);
    delete manifest.documents[deletedPath];
  }

  for (const filePath of collected.files) {
    try {
      const content = await adapter.read(filePath);
      const contentHash = await sha256Hex(content);
      const previous = manifest.documents[filePath];
      if (previous?.content_hash === contentHash && previous.config_fingerprint === configFingerprint) {
        result.skipped++;
        continue;
      }

      const texts = chunkText(content, project.rag?.chunk_words || 400).filter(text => text.trim());
      const hashes = await Promise.all(texts.map(text => chunkFingerprint(configFingerprint, text)));
      const chunks: Chunk[] = [];
      for (let index = 0; index < texts.length; index++) {
        const text = texts[index];
        const hash = hashes[index];
        let embedding = embeddingCache.get(hash);
        if (embedding) {
          result.reusedEmbeddings++;
        } else {
          embedding = await embeddings.embed(text);
          embeddingCache.set(hash, embedding);
          result.generatedEmbeddings++;
        }
        chunks.push({ id: `${filePath}#chunk-${index}`, note_path: filePath, chunk_text: text, embedding });
      }
      vectorStore.addChunks(chunks, filePath);
      manifest.documents[filePath] = {
        path: filePath,
        content_hash: contentHash,
        config_fingerprint: configFingerprint,
        chunk_hashes: hashes,
        indexed_at: Date.now(),
      };
      result.totalNotes++;
      result.totalChunks += chunks.length;
      result.indexed++;
    } catch (error: any) {
      const message = error?.message || String(error);
      result.errors.push(`${filePath}: ${message}`);
      if (isEmbeddingExhaustedError(message)) {
        const remaining = collected.files.length - result.indexed - result.skipped - result.errors.length;
        if (remaining > 0) {
          result.errors.push(`Indexación detenida: embeddings agotados (${remaining} notas pendientes)`);
        }
        break;
      }
    }
  }

  await vectorStore.save(adapter);
  await saveManifest(adapter, project.id, manifest);
  if (loaded.migrated) console.error(`[Indexer] Manifiesto de ${project.id} migrado a schema v${INDEX_MANIFEST_SCHEMA_VERSION}`);
  return result;
}

/** Serializes index operations per project without dropping changes arriving mid-run. */
export function indexProject(
  adapter: IndexAdapter,
  embeddings: EmbeddingProvider,
  project: Project,
  vectorStore: VectorStore,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const previous = projectIndexChains.get(project.id) || Promise.resolve();
  const job = previous.catch(() => undefined).then(() => indexProjectInternal(adapter, embeddings, project, vectorStore, options));
  const tracked = job.finally(() => {
    if (projectIndexChains.get(project.id) === tracked) projectIndexChains.delete(project.id);
  });
  projectIndexChains.set(project.id, tracked);
  return tracked;
}
