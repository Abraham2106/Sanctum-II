/**
 * DEC-0022: immutable per-project index generations (reader/writer metadata).
 */
import { embedModelForVectorIdentity, type EmbeddingEnvSlice, type ResolvedEmbeddingConfig } from "../embeddings/embedding-config";
import { buildGeminiIdentity, type EmbeddingIdentityDocument } from "../embeddings/embedding-identity";
import type { SanctumSettings } from "../constants";
import { isNotFoundError } from "../core/vault-fs";
import { withResourceLock } from "../core/resource-queue";
import type { VectorIdentity } from "../runtime/ports";
import { VectorStore } from "../rag/vector-store";
import type { Chunk } from "../rag/vector-store";
import {
  buildIndexFingerprint,
  findNewestCompleteGeneration,
  generationFile,
  generationRoot,
  type IndexGenerationMetadata,
  type IndexVaultAdapter,
  parseVectorStoreRaw,
  vectorIdentityFromMetadata,
} from "./index-generations-seal";

export type IndexSnapshotStatus = "ready" | "rebuild_required" | "unavailable" | "corrupt";

export interface IndexGenerationSnapshot {
  status: IndexSnapshotStatus;
  projectId: string;
  generationId?: string;
  vectorStorePath?: string;
  kgEdgesPath?: string;
  identity?: VectorIdentity;
  metadata?: IndexGenerationMetadata;
  stale?: boolean;
  reason?: string;
}

export {
  buildIndexFingerprint,
  findNewestCompleteGeneration,
  generationDir,
  generationFile,
  generationRoot,
  listGenerationIds,
  parseVectorStoreRaw,
  serializeKgEdges,
  serializeVectorStore,
  validateCompleteGeneration,
  writeGenerationArtifacts,
  type GenerationCommitDocument,
  type IndexGenerationMetadata,
  type IndexVaultAdapter,
} from "./index-generations-seal";

const activeSnapshots = new Map<string, IndexGenerationSnapshot>();

function legacyIndexPaths(projectId: string): string[] {
  return [
    `sanctum-logs/index/${projectId}/manifest.json`,
    `sanctum-logs/index/${projectId}/vector-store.jsonl`,
    `sanctum-logs/index/${projectId}/kg-edges.jsonl`,
  ];
}

async function hasLegacyLayout(adapter: IndexVaultAdapter, projectId: string): Promise<boolean> {
  for (const path of legacyIndexPaths(projectId)) {
    if (await adapter.exists(path)) return true;
  }
  return false;
}

async function readStaleFlag(adapter: IndexVaultAdapter, projectId: string): Promise<boolean> {
  const path = `sanctum-logs/index/${projectId}/stale.json`;
  if (!(await adapter.exists(path))) return false;
  try {
    const raw = JSON.parse(await adapter.read(path));
    return raw?.stale === true;
  } catch {
    return false;
  }
}

export async function markIndexStale(adapter: IndexVaultAdapter, projectId: string): Promise<void> {
  const path = `sanctum-logs/index/${projectId}/stale.json`;
  await adapter.write(path, JSON.stringify({ stale: true, markedAt: new Date().toISOString() }, null, 2));
}

export async function clearIndexStale(adapter: IndexVaultAdapter, projectId: string): Promise<void> {
  const path = `sanctum-logs/index/${projectId}/stale.json`;
  if (adapter.remove && (await adapter.exists(path))) {
    await adapter.remove(path);
    return;
  }
  await adapter.write(path, JSON.stringify({ stale: false }, null, 2));
}

export function getCachedIndexSnapshot(projectId: string): IndexGenerationSnapshot | undefined {
  return activeSnapshots.get(projectId);
}

export function setCachedIndexSnapshot(projectId: string, snapshot: IndexGenerationSnapshot): void {
  activeSnapshots.set(projectId, snapshot);
}

export function clearCachedIndexSnapshot(projectId: string): void {
  activeSnapshots.delete(projectId);
}

/** DEC-0022: load newest sealed generation or classify legacy / missing / corrupt. */
export async function loadIndexGenerationSnapshot(
  adapter: IndexVaultAdapter,
  projectId: string,
): Promise<IndexGenerationSnapshot> {
  const stale = await readStaleFlag(adapter, projectId);
  const complete = await findNewestCompleteGeneration(adapter, projectId);
  if (complete) {
    const snapshot: IndexGenerationSnapshot = {
      status: "ready",
      projectId,
      generationId: complete.generationId,
      vectorStorePath: generationFile(projectId, complete.generationId, "vector-store.jsonl"),
      kgEdgesPath: generationFile(projectId, complete.generationId, "kg-edges.jsonl"),
      identity: vectorIdentityFromMetadata(complete.metadata),
      metadata: complete.metadata,
      stale,
    };
    activeSnapshots.set(projectId, snapshot);
    return snapshot;
  }

  const partialDirs = await listPartialGenerationDirs(adapter, projectId);
  if (partialDirs.length > 0) {
    const hasCompleteOlder = await hasAnyCompleteGeneration(adapter, projectId);
    if (hasCompleteOlder) {
      const cached = activeSnapshots.get(projectId);
      if (cached?.status === "ready") {
        return { ...cached, stale: stale || cached.stale };
      }
    }
  }

  if (await hasLegacyLayout(adapter, projectId)) {
    const snapshot: IndexGenerationSnapshot = {
      status: "rebuild_required",
      projectId,
      stale,
      reason: "legacy_layout",
    };
    activeSnapshots.set(projectId, snapshot);
    return snapshot;
  }

  if (partialDirs.length > 0) {
    const snapshot: IndexGenerationSnapshot = {
      status: "corrupt",
      projectId,
      stale,
      reason: "incomplete_generation",
    };
    return snapshot;
  }

  const snapshot: IndexGenerationSnapshot = {
    status: "unavailable",
    projectId,
    stale,
  };
  activeSnapshots.set(projectId, snapshot);
  return snapshot;
}

async function listPartialGenerationDirs(adapter: IndexVaultAdapter, projectId: string): Promise<string[]> {
  const root = generationRoot(projectId);
  if (!(await adapter.exists(root))) return [];
  const listing = await adapter.list(root);
  const ids: string[] = [];
  for (const folder of listing.folders) {
    const id = folder.replace(/\\/g, "/").split("/").pop() ?? "";
    if (!id) continue;
    const hasCommit = await adapter.exists(generationFile(projectId, id, "commit.json"));
    if (!hasCommit) ids.push(id);
  }
  return ids;
}

async function hasAnyCompleteGeneration(adapter: IndexVaultAdapter, projectId: string): Promise<boolean> {
  return (await findNewestCompleteGeneration(adapter, projectId)) !== null;
}

export async function loadGenerationVectorStore(
  adapter: IndexVaultAdapter,
  projectId: string,
  generationId?: string,
): Promise<VectorStore | null> {
  let meta: IndexGenerationMetadata | undefined;
  let genId = generationId;
  if (!genId) {
    const found = await findNewestCompleteGeneration(adapter, projectId);
    if (!found) return null;
    genId = found.generationId;
    meta = found.metadata;
  }
  const path = generationFile(projectId, genId, "vector-store.jsonl");
  const store = new VectorStore(path);
  try {
    await store.load(adapter);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  if (meta) {
    setCachedIndexSnapshot(projectId, {
      status: "ready",
      projectId,
      generationId: genId,
      vectorStorePath: path,
      kgEdgesPath: generationFile(projectId, genId, "kg-edges.jsonl"),
      identity: vectorIdentityFromMetadata(meta),
      metadata: meta,
    });
  }
  return store;
}

export async function withProjectIndexLock<T>(
  adapter: IndexVaultAdapter,
  projectId: string,
  work: () => Promise<T>,
): Promise<T> {
  return withResourceLock(adapter, `sanctum-logs/index/${projectId}`, work);
}

export function resolveIndexingIdentity(
  project: { id: string; rag?: { embed_model?: string; dims?: number } },
  config: ResolvedEmbeddingConfig,
  override?: EmbeddingIdentityDocument,
): EmbeddingIdentityDocument {
  if (override && override.version === 1) return override;
  const ragDims = project.rag?.dims;
  const dims =
    config.backend === "gemini" && Number.isInteger(ragDims) && (ragDims as number) > 0
      ? (ragDims as number)
      : config.dims;
  const ragModel = project.rag?.embed_model?.trim() || "gemini-embedding-2";
  if (config.backend === "sentence-transformers") {
    throw new Error("Local indexing requires expectedIdentity from health pin");
  }
  return buildGeminiIdentity(ragModel, dims);
}

export async function computeIndexingFingerprint(
  identity: EmbeddingIdentityDocument,
  config: ResolvedEmbeddingConfig,
  project: { rag?: { embed_model?: string } },
  chunkWords: number,
): Promise<string> {
  const embedModel = embedModelForVectorIdentity(config, project.rag?.embed_model?.trim() || "gemini-embedding-2");
  return buildIndexFingerprint({
    embedModel,
    dims: identity.dims,
    chunkWords,
    configFingerprint: identity.configFingerprint,
  });
}

export type IndexBuildContext = {
  settings?: SanctumSettings;
  env?: EmbeddingEnvSlice;
  expectedIdentity?: EmbeddingIdentityDocument;
};

/** Apply staged chunks to an in-memory store only after a generation seal succeeds. */
export function applyChunksToStore(store: VectorStore, chunksByNote: Map<string, Chunk[]>): void {
  for (const [notePath, chunks] of chunksByNote) {
    store.addChunks(chunks, notePath);
  }
}
