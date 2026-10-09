import { pathMatchesAny } from "../utils";
import { isNotFoundError } from "../core/vault-fs";
import { withResourceLock } from "../core/resource-queue";

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

type VectorSemanticOp = { kind: "replace_note"; notePath: string; chunks: readonly Chunk[] };

type VectorReplayEntry =
  | { type: "semantic"; op: VectorSemanticOp }
  | { type: "txn"; line: string };

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

function float32ArrayToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToFloat32Array(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

async function readExistingOrEmpty(adapter: Pick<VectorStoreAdapter, "read">, path: string): Promise<string> {
  try {
    return await adapter.read(path);
  } catch (error) {
    if (isNotFoundError(error)) return "";
    throw error;
  }
}

async function appendToFile(
  adapter: VectorStoreAdapter,
  path: string,
  content: string
): Promise<void> {
  if (typeof adapter.append === "function") {
    await adapter.append(path, content);
    return;
  }
  let existing = "";
  if (typeof adapter.exists === "function") {
    if (await adapter.exists(path)) {
      existing = await readExistingOrEmpty(adapter, path);
    }
  } else {
    existing = await readExistingOrEmpty(adapter, path);
  }
  await adapter.write(path, existing ? `${existing}${content}` : content);
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

  private applyTxnLine(line: string, maps: {
    chunksMap: Map<string, Chunk>;
    noteToChunksMap: Map<string, Set<string>>;
    dims: number;
  }): void {
    if (!line.trim()) return;
    try {
      const txn = JSON.parse(line);
      if (txn.t === "set") {
        const floatArr = base64ToFloat32Array(txn.v);
        const embedding = Array.from(floatArr);

        const chunk: Chunk = {
          id: txn.id,
          note_path: txn.p,
          chunk_text: txn.txt,
          embedding
        };
        maps.chunksMap.set(txn.id, chunk);

        let noteSet = maps.noteToChunksMap.get(txn.p);
        if (!noteSet) {
          noteSet = new Set<string>();
          maps.noteToChunksMap.set(txn.p, noteSet);
        }
        noteSet.add(txn.id);

        if (embedding.length > 0 && !maps.dims) {
          maps.dims = embedding.length;
        }
      } else if (txn.t === "del") {
        const chunk = maps.chunksMap.get(txn.id);
        if (chunk) {
          const noteSet = maps.noteToChunksMap.get(chunk.note_path);
          if (noteSet) {
            noteSet.delete(txn.id);
            if (noteSet.size === 0) {
              maps.noteToChunksMap.delete(chunk.note_path);
            }
          }
          maps.chunksMap.delete(txn.id);
        }
      }
    } catch (e) {
      console.error("Error parsing transaction line in vector store log:", e);
    }
  }

  private mapsFromRaw(raw: string): {
    chunksMap: Map<string, Chunk>;
    noteToChunksMap: Map<string, Set<string>>;
    dims: number;
  } {
    const maps = {
      chunksMap: new Map<string, Chunk>(),
      noteToChunksMap: new Map<string, Set<string>>(),
      dims: 0,
    };
    for (const line of raw.split("\n")) {
      this.applyTxnLine(line, maps);
    }
    return maps;
  }

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
    this.installMaps(this.mapsFromRaw(raw));
  }

  private enqueueTxn(line: string): void {
    this.pendingTxns.push(line);
    this.replayLog.push({ type: "txn", line });
  }

  private cloneChunk(chunk: Chunk): Chunk {
    return {
      id: chunk.id,
      note_path: chunk.note_path,
      chunk_text: chunk.chunk_text,
      embedding: [...chunk.embedding],
    };
  }

  private chunkToSetLine(chunk: Chunk): string {
    const b64 = float32ArrayToBase64(new Float32Array(chunk.embedding));
    return JSON.stringify({
      t: "set",
      id: chunk.id,
      p: chunk.note_path,
      txt: chunk.chunk_text,
      v: b64,
    }) + "\n";
  }

  private applyReplaceNoteSemantic(
    op: VectorSemanticOp,
    staged: {
      chunksMap: Map<string, Chunk>;
      noteToChunksMap: Map<string, Set<string>>;
      dims: number;
    }
  ): void {
    const keep = new Set(op.chunks.map((c) => c.id));
    const stagedIds = staged.noteToChunksMap.get(op.notePath);
    if (stagedIds) {
      for (const id of [...stagedIds]) {
        if (!keep.has(id)) {
          staged.chunksMap.delete(id);
          stagedIds.delete(id);
        }
      }
      if (stagedIds.size === 0) {
        staged.noteToChunksMap.delete(op.notePath);
      }
    }

    const mergedIds = new Set<string>();
    for (const chunk of op.chunks) {
      const cloned = this.cloneChunk(chunk);
      staged.chunksMap.set(cloned.id, cloned);
      mergedIds.add(cloned.id);
      if (cloned.embedding.length > 0 && !staged.dims) {
        staged.dims = cloned.embedding.length;
      }
    }
    if (mergedIds.size > 0) {
      staged.noteToChunksMap.set(op.notePath, mergedIds);
    } else {
      staged.noteToChunksMap.delete(op.notePath);
    }
  }

  private materializeReplaceNoteTxns(
    op: VectorSemanticOp,
    staged: {
      chunksMap: Map<string, Chunk>;
      noteToChunksMap: Map<string, Set<string>>;
      dims: number;
    }
  ): string[] {
    const lines: string[] = [];
    const keep = new Set(op.chunks.map((c) => c.id));
    const stagedIds = staged.noteToChunksMap.get(op.notePath);
    if (stagedIds) {
      for (const id of [...stagedIds]) {
        if (!keep.has(id)) {
          lines.push(JSON.stringify({ t: "del", id }) + "\n");
        }
      }
    }
    for (const chunk of op.chunks) {
      lines.push(this.chunkToSetLine(chunk));
    }
    return lines;
  }

  private async buildPersistBatchFromReplay(replayEnd: number, adapter: Pick<VectorStoreAdapter, "read">): Promise<string[]> {
    const raw = await readExistingOrEmpty(adapter, this.storePath);
    const staged = this.mapsFromRaw(raw);
    const lines: string[] = [];
    for (let i = 0; i < replayEnd; i++) {
      const entry = this.replayLog[i];
      if (entry.type === "txn") {
        lines.push(entry.line);
        this.applyTxnLine(entry.line, staged);
      } else {
        for (const line of this.materializeReplaceNoteTxns(entry.op, staged)) {
          lines.push(line);
        }
        this.applyReplaceNoteSemantic(entry.op, staged);
      }
    }
    return lines;
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
        this.applyReplaceNoteSemantic(entry.op, staged);
      } else {
        this.applyTxnLine(entry.line, staged);
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
        const staged = this.mapsFromRaw(raw);
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
          const staged = this.mapsFromRaw("");
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
    const replayCount = replayRef.length;
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
        ? await this.buildPersistBatchFromReplay(replayCount, adapter)
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

    const clonedChunks = newChunks.map((c) => this.cloneChunk(c));
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
