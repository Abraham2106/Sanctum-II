import { resolveEffectiveEmbeddingConfig, type EmbeddingEnvSlice } from "../embeddings/embedding-config";
import { buildGeminiIdentity, type EmbeddingIdentityDocument } from "../embeddings/embedding-identity";
import type { SanctumSettings } from "../constants";
import { ensureVaultDirectory } from "../core/vault-fs";
import type { KgEdge } from "../kg/types";
import { VectorStore, type Chunk } from "../rag/vector-store";
import type { EmbedderPort } from "../runtime/ports";
import type { Project } from "./types";
import { isInternalPath } from "../utils";
import {
  applyChunksToStore,
  clearIndexStale,
  computeIndexingFingerprint,
  findNewestCompleteGeneration,
  generationDir,
  loadIndexGenerationSnapshot,
  parseVectorStoreRaw,
  resolveIndexingIdentity,
  serializeKgEdges,
  serializeVectorStore,
  setCachedIndexSnapshot,
  type IndexGenerationMetadata,
  type IndexVaultAdapter,
  withProjectIndexLock,
  writeGenerationArtifacts,
} from "./index-generations";
import {
  chunkText,
  chunkWordsFor,
  extractExplicitEdges,
  filterKgEdgeEndpoints,
  isAllowedPath,
  isWithinPath,
  listMarkdownRecursive,
  newGenerationId,
  sha256NoteContent,
  toEmbedderPort,
  type LegacyEmbedder,
} from "./indexer-support";

export interface IndexResult {
  totalNotes: number;
  totalChunks: number;
  indexed: number;
  skipped: number;
  errors: string[];
  generationId?: string;
}

export interface IndexOptions {
  paths?: string[];
  settings?: SanctumSettings;
  env?: EmbeddingEnvSlice;
  expectedIdentity?: EmbeddingIdentityDocument;
}

const activeIndexJobs = new Map<string, Promise<IndexResult>>();

async function indexProjectInternal(
  adapter: IndexVaultAdapter,
  embedderInput: EmbedderPort | LegacyEmbedder,
  project: Project,
  vectorStore: VectorStore,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const embedder = toEmbedderPort(embedderInput);
  const errors: string[] = [];
  let totalNotes = 0;
  let totalChunks = 0;
  let indexed = 0;
  let skipped = 0;

  if (!project.read_paths?.length) {
    return {
      totalNotes: 0,
      totalChunks: 0,
      indexed: 0,
      skipped: 0,
      errors: ["read_paths vacíos: indexación denegada"],
    };
  }

  if (!embedder.hasKeys) {
    return {
      totalNotes: 0,
      totalChunks: 0,
      indexed: 0,
      skipped: 0,
      errors: ["Proveedor de embeddings no configurado"],
    };
  }

  const settings = options.settings ?? ({} as SanctumSettings);
  const config = resolveEffectiveEmbeddingConfig(settings, project, options.env);
  let identity: EmbeddingIdentityDocument;
  try {
    identity = resolveIndexingIdentity(project, config, options.expectedIdentity);
  } catch (err: any) {
    return { totalNotes: 0, totalChunks: 0, indexed: 0, skipped: 0, errors: [err.message] };
  }

  const chunkWords = chunkWordsFor(project);
  const indexFingerprint = await computeIndexingFingerprint(identity, config, project, chunkWords);
  const embedModel =
    config.backend === "sentence-transformers"
      ? config.model.trim()
      : (project.rag?.embed_model?.trim() || "gemini-embedding-2");

  await ensureVaultDirectory(adapter, `sanctum-logs/index/${project.id}`);
  await ensureVaultDirectory(adapter, generationDir(project.id, "_pending"));

  const previous = await findNewestCompleteGeneration(adapter, project.id);

  const configuredPaths = project.read_paths.map((p) => p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
  const targetPaths = (options.paths?.length ? options.paths : configuredPaths).map((p) =>
    p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
  );
  const partial = Boolean(options.paths?.length);
  if (partial && previous && previous.metadata.indexFingerprint !== indexFingerprint) {
    return {
      totalNotes: 0,
      totalChunks: 0,
      indexed: 0,
      skipped: 0,
      errors: ["Cambio de fingerprint de índice: reindexación completa requerida"],
    };
  }
  if (options.paths?.length && !targetPaths.every((path) => isAllowedPath(path, configuredPaths))) {
    return {
      totalNotes: 0,
      totalChunks: 0,
      indexed: 0,
      skipped: 0,
      errors: ["La carpeta solicitada está fuera de los read_paths del proyecto"],
    };
  }

  const canReuse = previous !== null && previous.metadata.indexFingerprint === indexFingerprint;

  let reuseManifest: Record<string, string> = {};
  let reuseChunksByNote = new Map<string, Chunk[]>();
  if (canReuse && previous) {
    try {
      reuseManifest = JSON.parse(
        await adapter.read(`${generationDir(project.id, previous.generationId)}/manifest.json`),
      );
      const raw = await adapter.read(
        `${generationDir(project.id, previous.generationId)}/vector-store.jsonl`,
      );
      for (const chunk of parseVectorStoreRaw(raw)) {
        let list = reuseChunksByNote.get(chunk.note_path);
        if (!list) {
          list = [];
          reuseChunksByNote.set(chunk.note_path, list);
        }
        list.push(chunk);
      }
    } catch (err: any) {
      errors.push(`No se pudo cargar generación previa para reuse: ${err.message}`);
      reuseManifest = {};
      reuseChunksByNote = new Map();
    }
  }

  const allFiles: string[] = [];
  for (const targetPath of targetPaths) {
    const exists = await adapter.exists(targetPath).catch(() => false);
    if (!exists) {
      errors.push(`La carpeta ${targetPath} no existe`);
      continue;
    }
    try {
      const files = await listMarkdownRecursive(adapter, targetPath, configuredPaths);
      for (const f of files) {
        if (!allFiles.includes(f)) allFiles.push(f);
      }
    } catch (err: any) {
      errors.push(`list ${targetPath}: ${err.message}`);
      return { totalNotes, totalChunks, indexed, skipped, errors };
    }
  }

  const newManifest: Record<string, string> = partial && canReuse ? { ...reuseManifest } : {};
  const filesToPrune = new Set(
    Object.keys(reuseManifest).filter(
      (note) => !partial || targetPaths.some((path) => isWithinPath(note, path)),
    ),
  );

  const stagingChunks = new Map<string, Chunk[]>();
  const kgEdges: KgEdge[] = [];
  const kgSeen = new Set<string>();

  for (const filePath of allFiles) {
    const noteName = filePath.replace(/\\/g, "/");
    filesToPrune.delete(noteName);

    if (isInternalPath(noteName)) continue;

    try {
      const content = await adapter.read(filePath);
      const hash = await sha256NoteContent(content);

      for (const edge of extractExplicitEdges(content, noteName)) {
        if (!filterKgEdgeEndpoints(edge, configuredPaths)) continue;
        const key = [edge.from, edge.to].sort().join("::");
        if (kgSeen.has(key)) continue;
        kgSeen.add(key);
        kgEdges.push(edge);
      }

      if (canReuse && reuseManifest[noteName] === hash) {
        const reused = reuseChunksByNote.get(noteName);
        if (reused?.length) {
          stagingChunks.set(
            noteName,
            reused.map((c) => ({ ...c, embedding: [...c.embedding] })),
          );
          newManifest[noteName] = hash;
          skipped++;
          continue;
        }
      }

      const textChunks = chunkText(content, chunkWords);
      const newChunks: Chunk[] = [];
      const embedModelOpt = config.backend === "gemini" ? embedModel : undefined;
      for (let ci = 0; ci < textChunks.length; ci++) {
        const text = textChunks[ci];
        if (!text.trim()) continue;
        const embedding = await embedder.embed(text.slice(0, 3000), {
          purpose: "document",
          model: embedModelOpt,
          expectedIdentity: identity,
        });
        if (embedding.length !== identity.dims) {
          throw new Error(`Dims mismatch: expected ${identity.dims}, got ${embedding.length}`);
        }
        newChunks.push({
          id: `${noteName}#chunk-${ci}`,
          note_path: noteName,
          chunk_text: text,
          embedding,
        });
      }

      stagingChunks.set(noteName, newChunks);
      newManifest[noteName] = hash;
      totalChunks += newChunks.length;
      totalNotes++;
      indexed++;
    } catch (err: any) {
      errors.push(`${filePath}: ${err.message}`);
    }
  }

  for (const deletedPath of filesToPrune) {
    stagingChunks.set(deletedPath, []);
    delete newManifest[deletedPath];
  }

  if (errors.length > 0 && indexed === 0 && skipped === 0) {
    return { totalNotes, totalChunks, indexed, skipped, errors };
  }

  const generationId = newGenerationId();
  const allChunks: Chunk[] = [];
  for (const chunks of stagingChunks.values()) {
    allChunks.push(...chunks);
  }

  const metadata: IndexGenerationMetadata = {
    version: 1,
    generationId,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    indexFingerprint,
    chunkWords,
    embedModel,
    dims: identity.dims,
    identity,
  };

  try {
    await writeGenerationArtifacts(adapter, project.id, generationId, {
      metadata,
      manifest: newManifest,
      vectorStore: serializeVectorStore(allChunks),
      kgEdges: serializeKgEdges(kgEdges),
    });
  } catch (err: any) {
    errors.push(`Fallo al publicar generación: ${err.message}`);
    return { totalNotes, totalChunks, indexed, skipped, errors };
  }

  await clearIndexStale(adapter, project.id);
  const snapshot = await loadIndexGenerationSnapshot(adapter, project.id);
  setCachedIndexSnapshot(project.id, snapshot);

  vectorStore.clear();
  applyChunksToStore(vectorStore, stagingChunks);

  return {
    totalNotes,
    totalChunks,
    indexed,
    skipped,
    errors,
    generationId,
  };
}

export function indexProject(
  adapter: IndexVaultAdapter,
  embedder: EmbedderPort | LegacyEmbedder,
  project: Project,
  vectorStore: VectorStore,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const existing = activeIndexJobs.get(project.id);
  if (existing) return existing;
  const job = withProjectIndexLock(adapter, project.id, () =>
    indexProjectInternal(adapter, embedder, project, vectorStore, options),
  );
  activeIndexJobs.set(project.id, job);
  return job.finally(() => {
    if (activeIndexJobs.get(project.id) === job) activeIndexJobs.delete(project.id);
  });
}

export function buildTestGeminiIdentity(project: Project): EmbeddingIdentityDocument {
  const model = project.rag?.embed_model?.trim() || "gemini-embedding-2";
  const dims = project.rag?.dims ?? 768;
  return buildGeminiIdentity(model, dims);
}

export { sha256NoteContent as noteContentHashForTests };
