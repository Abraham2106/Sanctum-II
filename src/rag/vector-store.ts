import { pathMatchesAny } from "../utils";
import { isNotFoundError } from "../core/vault-fs";
import { withResourceLock } from "../core/resource-queue";
import { float32ArrayToBase64 } from "./vector-store-encoding";
import { appendToFile } from "./vector-store-io";
import {
  applyReplaceNoteSemantic,
  applyTxnLine,
  buildPersistBatchFromReplaySnapshot,
  cloneChunk,
  mapsFromRaw,
  type VectorReplayEntry,
} from "./vector-store-replay";

export interface VectorStoreAdapter {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  append?: (path: string, content: string) => Promise<void>;
  exists?: (path: string) => Promise<boolean>;
}

export type VectorStoreReadAdapter = Pick<VectorStoreAdapter, "read">;

export interface Chunk {
  id: string;
  note_path: string;
  chunk_text: string;
  embedding: number[];
}

const DEFAULT_STORE_PATH = "sanctum-logs/vector-store.jsonl";

export function cosineSimilarity(a: number[], b: number[]): number {
  // DEC-0015: largos distintos no pueden ganar el ranking con NaN
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return 0;
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class VectorStore {
  private chunksMap = new Map<string, Chunk>();
  private noteToChunksMap = new Map<string, Set<string>>();
  private chunks: Chunk[] = [];
  private pendingTxns: string[] = [];
  private replayLog: VectorReplayEntry[] = [];
  private shouldTruncate = false;
  private dims = 0;
  private storePath: string;
  private mutationEpoch = 0;

  private touchMutation(): void {
    this.mutationEpoch++;
  }

  constructor(storePath?: string) {
    this.storePath = storePath || DEFAULT_STORE_PATH;
  }

  get count(): number {
    return this.chunks.length;
  }

  get allChunks(): Chunk[] {
    return this.chunks;
  }

  getStorePath(): string { return this.storePath; }

  private installMaps(maps: {
    chunksMap: Map<string, Chunk>;
    noteToChunksMap: Map<string, Set<string>>;
    dims: number;
  }): void {
    this.chunksMap = maps.chunksMap;
    this.noteToChunksMap = maps.noteToChunksMap;
    this.dims = maps.dims;
    this.chunks = Array.from(this.chunksMap.values());
  }

  private installFromRaw(raw: string): void {
    this.installMaps(mapsFromRaw(raw));
  }

  private retirePersistedPrefix(
    replayRef: VectorReplayEntry[],
    replayCount: number,
    pendingRef: string[],
    pendingCount: number
  ): void {
    if (this.replayLog === replayRef) {
      replayRef.splice(0, replayCount);
    }
    if (this.pendingTxns === pendingRef) {
      pendingRef.splice(0, pendingCount);
    }
  }

  private replayOntoMaps(staged: {
    chunksMap: Map<string, Chunk>;
    noteToChunksMap: Map<string, Set<string>>;
    dims: number;
  }): void {
    for (const entry of this.replayLog) {
      if (entry.type === "semantic") {
        applyReplaceNoteSemantic(entry.op, staged);
      } else {
        applyTxnLine(entry.line, staged);
      }
    }
  }

  private resetMapsToEmpty(): void {
    this.chunksMap.clear();
    this.noteToChunksMap.clear();
    this.chunks = [];
    this.dims = 0;
  }

  async load(adapter: VectorStoreReadAdapter): Promise<void> {
    const epochAtStart = this.mutationEpoch;
    await withResourceLock(adapter, this.storePath, () => this.loadUnlocked(adapter, epochAtStart));
  }

  private async loadUnlocked(adapter: VectorStoreReadAdapter, epochAtStart: number): Promise<void> {
    try {
      const raw = await adapter.read(this.storePath);
      if (this.mutationEpoch === epochAtStart && this.replayLog.length === 0 && !this.shouldTruncate) {
        this.installFromRaw(raw);
        this.pendingTxns = [];
        this.shouldTruncate = false;
      } else if (this.shouldTruncate) {
        // clear() during load stays authoritative over disk baseline
      } else {
        const staged = mapsFromRaw(raw);
        this.replayOntoMaps(staged);
        this.installMaps(staged);
      }
      console.error(`[VectorStore] ✅ Loaded ${this.chunks.length} chunks from ${this.storePath}`);
    } catch (error) {
      if (isNotFoundError(error)) {
        if (this.mutationEpoch === epochAtStart && this.replayLog.length === 0 && !this.shouldTruncate) {
          this.resetMapsToEmpty();
          this.pendingTxns = [];
          this.shouldTruncate = false;
        } else if (!this.shouldTruncate && this.replayLog.length > 0) {
          const staged = mapsFromRaw("");
          this.replayOntoMaps(staged);
          this.installMaps(staged);
        }
        console.error(`[VectorStore] 📄 No existing store at ${this.storePath} — starting empty`);
        return;
      }
      console.error(`[VectorStore] failed to load ${this.storePath}:`, error);
      throw error;
    }
  }

  async save(adapter: VectorStoreAdapter): Promise<void> {
    await withResourceLock(adapter, this.storePath, () => this.saveUnlocked(adapter));
  }

  private async saveUnlocked(adapter: VectorStoreAdapter): Promise<void> {
    const replayRef = this.replayLog;
    const replaySnapshot = replayRef.slice();
    const replayCount = replaySnapshot.length;
    const pendingRef = this.pendingTxns;
    const pendingCountAtCapture = pendingRef.length;

    if (this.shouldTruncate) {
      const txns: string[] = [];
      for (const chunk of this.chunksMap.values()) {
        const b64 = float32ArrayToBase64(new Float32Array(chunk.embedding));
        txns.push(JSON.stringify({
          t: "set",
          id: chunk.id,
          p: chunk.note_path,
          txt: chunk.chunk_text,
          v: b64
        }));
      }
      const fileContent = txns.length > 0 ? txns.join("\n") + "\n" : "";
      await adapter.write(this.storePath, fileContent);
      if (this.pendingTxns === pendingRef) {
        this.shouldTruncate = false;
        this.retirePersistedPrefix(replayRef, replayCount, pendingRef, pendingCountAtCapture);
        console.error(`[VectorStore] 💾 Truncate-saved ${this.chunks.length} chunks to ${this.storePath} (${(fileContent.length / 1024).toFixed(1)}KB)`);
      }
      return;
    }

    const appendLines =
      replayCount > 0
        ? await buildPersistBatchFromReplaySnapshot(replaySnapshot, this.storePath, adapter)
        : pendingRef.slice(0, pendingCountAtCapture);
    if (appendLines.length === 0) return;

    const appendContent = appendLines.join("");
    await appendToFile(adapter, this.storePath, appendContent);
    if (this.pendingTxns === pendingRef) {
      this.retirePersistedPrefix(replayRef, replayCount, pendingRef, pendingCountAtCapture);
      console.info(`[VectorStore] 💾 Append-saved ${appendLines.length} txns to ${this.storePath}`);
    }
  }

  addChunks(newChunks: Chunk[], notePath?: string): void {
    const path = notePath || (newChunks.length > 0 ? newChunks[0].note_path : undefined);
    if (!path) return;

    this.touchMutation();

    const clonedChunks = newChunks.map((c) => cloneChunk(c));
    this.replayLog.push({
      type: "semantic",
      op: { kind: "replace_note", notePath: path, chunks: clonedChunks },
    });

    const oldChunkIds = this.noteToChunksMap.get(path);
    if (oldChunkIds) {
      for (const oldId of oldChunkIds) {
        this.chunksMap.delete(oldId);
      }
      this.noteToChunksMap.delete(path);
    }

    if (newChunks.length > 0) {
      const newSet = new Set<string>();
      for (const c of newChunks) {
        this.chunksMap.set(c.id, c);
        newSet.add(c.id);
      }
      this.noteToChunksMap.set(path, newSet);

      if (!this.dims && newChunks[0].embedding) {
        this.dims = newChunks[0].embedding.length;
      }
    }

    this.chunks = Array.from(this.chunksMap.values());
  }

  clear(): void {
    this.touchMutation();
    this.chunksMap.clear();
    this.noteToChunksMap.clear();
    this.chunks = [];
    this.pendingTxns = [];
    this.replayLog = [];
    this.shouldTruncate = true;
    this.dims = 0;
  }

  search(
    queryEmbedding: number[],
    topK: number = 5
  ): { chunk: Chunk; score: number }[] {
    const scored = this.chunks.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  filterByPaths(results: { chunk: Chunk; score: number }[], allowedPaths: string[]): { chunk: Chunk; score: number }[] {
    if (allowedPaths.length === 0) return [];
    return results.filter((r) => pathMatchesAny(r.chunk.note_path, allowedPaths));
  }
}
