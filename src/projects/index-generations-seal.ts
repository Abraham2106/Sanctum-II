import { canonicalJsonString } from "../embeddings/embedding-identity-canonical";
import {
  identityDocumentValid,
  type EmbeddingIdentityDocument,
} from "../embeddings/embedding-identity";
import type { VectorIdentity } from "../runtime/ports";
import { chunkToSetLine } from "../rag/vector-store-encoding";
import type { Chunk } from "../rag/vector-store";
import type { KgEdge } from "../kg/types";
import { mapsFromRaw } from "../rag/vector-store-replay";

export const GENERATION_COMMIT_VERSION = 1;
export const GENERATION_METADATA_VERSION = 1;

export type IndexVaultAdapter = {
  read: (p: string) => Promise<string>;
  write: (p: string, c: string) => Promise<void>;
  list: (p: string) => Promise<{ files: string[]; folders: string[] }>;
  exists: (p: string) => Promise<boolean>;
  mkdir: (p: string) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  remove?: (p: string) => Promise<void>;
};

export interface IndexGenerationMetadata {
  version: typeof GENERATION_METADATA_VERSION;
  generationId: string;
  projectId: string;
  createdAt: string;
  indexFingerprint: string;
  chunkWords: number;
  embedModel: string;
  dims: number;
  identity: EmbeddingIdentityDocument;
}

export interface GenerationCommitDocument {
  version: typeof GENERATION_COMMIT_VERSION;
  generationId: string;
  publishedAt: string;
  hashes: {
    "metadata.json": string;
    "manifest.json": string;
    "vector-store.jsonl": string;
    "kg-edges.jsonl": string;
  };
}

export function generationRoot(projectId: string): string {
  return `sanctum-logs/index/${projectId}/generations`;
}

export function generationDir(projectId: string, generationId: string): string {
  return `${generationRoot(projectId)}/${generationId}`;
}

export function generationFile(projectId: string, generationId: string, name: string): string {
  return `${generationDir(projectId, generationId)}/${name}`;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildIndexFingerprint(input: {
  embedModel: string;
  dims: number;
  chunkWords: number;
  configFingerprint?: string;
}): Promise<string> {
  const payload: Record<string, string | number> = {
    chunkWords: input.chunkWords,
    dims: input.dims,
    embedModel: input.embedModel,
  };
  if (input.configFingerprint?.trim()) {
    payload.configFingerprint = input.configFingerprint.trim();
  }
  return sha256Hex(canonicalJsonString(payload));
}

export function vectorIdentityFromMetadata(meta: IndexGenerationMetadata): VectorIdentity {
  return {
    embedModel: meta.embedModel,
    dims: meta.dims,
    projectId: meta.projectId,
    generationId: meta.generationId,
    configFingerprint: meta.identity.configFingerprint,
    provenance: meta.indexFingerprint,
  };
}

export function metadataSchemaValid(raw: unknown): raw is IndexGenerationMetadata {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as IndexGenerationMetadata;
  if (m.version !== GENERATION_METADATA_VERSION) return false;
  if (!m.generationId?.trim() || !m.projectId?.trim()) return false;
  if (!m.indexFingerprint?.trim() || !m.embedModel?.trim()) return false;
  if (!Number.isInteger(m.chunkWords) || m.chunkWords <= 0) return false;
  if (!Number.isInteger(m.dims) || m.dims <= 0) return false;
  return identityDocumentValid(m.identity);
}

export function commitSchemaValid(raw: unknown): raw is GenerationCommitDocument {
  if (!raw || typeof raw !== "object") return false;
  const c = raw as GenerationCommitDocument;
  if (c.version !== GENERATION_COMMIT_VERSION) return false;
  if (!c.generationId?.trim() || !c.publishedAt?.trim()) return false;
  const h = c.hashes;
  if (!h || typeof h !== "object") return false;
  for (const key of ["metadata.json", "manifest.json", "vector-store.jsonl", "kg-edges.jsonl"] as const) {
    const v = h[key];
    if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) return false;
  }
  return true;
}

export async function hashFile(adapter: IndexVaultAdapter, path: string): Promise<string> {
  const content = await adapter.read(path);
  return sha256Hex(content);
}

export async function validateCompleteGeneration(
  adapter: IndexVaultAdapter,
  projectId: string,
  generationId: string,
): Promise<{ ok: true; metadata: IndexGenerationMetadata; commit: GenerationCommitDocument } | { ok: false }> {
  const base = generationDir(projectId, generationId);
  const commitPath = `${base}/commit.json`;
  if (!(await adapter.exists(commitPath))) return { ok: false };
  let commitRaw: unknown;
  try {
    commitRaw = JSON.parse(await adapter.read(commitPath));
  } catch {
    return { ok: false };
  }
  if (!commitSchemaValid(commitRaw) || commitRaw.generationId !== generationId) return { ok: false };

  const names = ["metadata.json", "manifest.json", "vector-store.jsonl", "kg-edges.jsonl"] as const;
  for (const name of names) {
    const filePath = `${base}/${name}`;
    if (!(await adapter.exists(filePath))) return { ok: false };
    const hash = await hashFile(adapter, filePath);
    if (hash !== commitRaw.hashes[name]) return { ok: false };
  }

  let metadataRaw: unknown;
  try {
    metadataRaw = JSON.parse(await adapter.read(`${base}/metadata.json`));
  } catch {
    return { ok: false };
  }
  if (!metadataSchemaValid(metadataRaw) || metadataRaw.generationId !== generationId) return { ok: false };
  if (metadataRaw.projectId !== projectId) return { ok: false };

  return { ok: true, metadata: metadataRaw, commit: commitRaw };
}

export async function listGenerationIds(adapter: IndexVaultAdapter, projectId: string): Promise<string[]> {
  const root = generationRoot(projectId);
  if (!(await adapter.exists(root))) return [];
  const listing = await adapter.list(root);
  return listing.folders
    .map((f) => f.replace(/\\/g, "/").split("/").pop() ?? "")
    .filter((id) => id.length > 0)
    .sort();
}

export async function findNewestCompleteGeneration(
  adapter: IndexVaultAdapter,
  projectId: string,
): Promise<{ generationId: string; metadata: IndexGenerationMetadata } | null> {
  const ids = await listGenerationIds(adapter, projectId);
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    const validated = await validateCompleteGeneration(adapter, projectId, id);
    if (validated.ok) {
      return { generationId: id, metadata: validated.metadata };
    }
  }
  return null;
}

export function serializeVectorStore(chunks: Chunk[]): string {
  if (chunks.length === 0) return "";
  return chunks.map((c) => chunkToSetLine(c)).join("");
}

export function parseVectorStoreRaw(raw: string): Chunk[] {
  return Array.from(mapsFromRaw(raw).chunksMap.values());
}

export function serializeKgEdges(edges: KgEdge[]): string {
  if (edges.length === 0) return "";
  return edges
    .map((e) =>
      JSON.stringify({
        t: "set",
        from: e.from,
        to: e.to,
        typ: e.type,
        w: e.weight,
        r: e.relation,
      }),
    )
    .join("\n") + "\n";
}

export async function publishGenerationCommit(
  adapter: IndexVaultAdapter,
  projectId: string,
  generationId: string,
  hashes: GenerationCommitDocument["hashes"],
): Promise<void> {
  const commit: GenerationCommitDocument = {
    version: GENERATION_COMMIT_VERSION,
    generationId,
    publishedAt: new Date().toISOString(),
    hashes,
  };
  const body = JSON.stringify(commit, null, 2);
  const finalPath = generationFile(projectId, generationId, "commit.json");
  const tmpPath = generationFile(projectId, generationId, "commit.json.tmp");
  await adapter.write(tmpPath, body);
  if (adapter.rename) {
    await adapter.rename(tmpPath, finalPath);
    return;
  }
  await adapter.write(finalPath, body);
  if (adapter.remove) {
    await adapter.remove(tmpPath).catch(() => undefined);
  }
}

export async function writeGenerationArtifacts(
  adapter: IndexVaultAdapter,
  projectId: string,
  generationId: string,
  files: {
    metadata: IndexGenerationMetadata;
    manifest: Record<string, string>;
    vectorStore: string;
    kgEdges: string;
  },
): Promise<void> {
  const dir = generationDir(projectId, generationId);
  await adapter.mkdir(dir);
  const metadataPath = `${dir}/metadata.json`;
  const manifestPath = `${dir}/manifest.json`;
  const vectorPath = `${dir}/vector-store.jsonl`;
  const kgPath = `${dir}/kg-edges.jsonl`;

  await adapter.write(metadataPath, JSON.stringify(files.metadata, null, 2));
  await adapter.write(manifestPath, JSON.stringify(files.manifest, null, 2));
  await adapter.write(vectorPath, files.vectorStore);
  await adapter.write(kgPath, files.kgEdges);

  const hashes = {
    "metadata.json": await hashFile(adapter, metadataPath),
    "manifest.json": await hashFile(adapter, manifestPath),
    "vector-store.jsonl": await hashFile(adapter, vectorPath),
    "kg-edges.jsonl": await hashFile(adapter, kgPath),
  };
  await publishGenerationCommit(adapter, projectId, generationId, hashes);
}
