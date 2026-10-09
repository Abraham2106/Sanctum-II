import { pathMatchesAny } from "../utils";
import { isNotFoundError } from "../core/vault-fs";
import { withResourceLock } from "../core/resource-queue";

interface VectorStoreAdapter {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  append?: (path: string, content: string) => Promise<void>;
  exists?: (path: string) => Promise<boolean>;
}

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

  private installFromRaw(raw: string): void {
    const lines = raw.split("\n");
    this.chunksMap.clear();
    this.noteToChunksMap.clear();
    this.dims = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
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
          this.chunksMap.set(txn.id, chunk);

          let noteSet = this.noteToChunksMap.get(txn.p);
          if (!noteSet) {
            noteSet = new Set<string>();
            this.noteToChunksMap.set(txn.p, noteSet);
          }
          noteSet.add(txn.id);

          if (embedding.length > 0 && !this.dims) {
            this.dims = embedding.length;
          }
        } else if (txn.t === "del") {
          const chunk = this.chunksMap.get(txn.id);
          if (chunk) {
            const noteSet = this.noteToChunksMap.get(chunk.note_path);
            if (noteSet) {
              noteSet.delete(txn.id);
              if (noteSet.size === 0) {
                this.noteToChunksMap.delete(chunk.note_path);
              }
            }
            this.chunksMap.delete(txn.id);
          }
        }
      } catch (e) {
        console.error("Error parsing transaction line in vector store log:", e);
      }
    }
    this.chunks = Array.from(this.chunksMap.values());
  }

  private resetMapsToEmpty(): void {
    this.chunksMap.clear();
    this.noteToChunksMap.clear();
    this.chunks = [];
    this.dims = 0;
  }

  async load(adapter: VectorStoreAdapter): Promise<void> {
    const epochAtStart = this.mutationEpoch;
    await withResourceLock(adapter, this.storePath, () => this.loadUnlocked(adapter, epochAtStart));
  }

  private async loadUnlocked(adapter: VectorStoreAdapter, epochAtStart: number): Promise<void> {
    try {
      const raw = await adapter.read(this.storePath);
      if (this.mutationEpoch !== epochAtStart) {
        this.shouldTruncate = true;
        return;
      }
      this.installFromRaw(raw);
      this.pendingTxns = [];
      this.shouldTruncate = false;
      console.error(`[VectorStore] ✅ Loaded ${this.chunks.length} chunks from ${this.storePath}`);
    } catch (error) {
      if (isNotFoundError(error)) {
        if (this.mutationEpoch === epochAtStart) {
          this.resetMapsToEmpty();
          this.pendingTxns = [];
          this.shouldTruncate = false;
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
    if (this.shouldTruncate) {
      const pendingRef = this.pendingTxns;
      const pendingBefore = pendingRef.length;
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
        pendingRef.splice(0, pendingBefore);
        console.error(`[VectorStore] 💾 Truncate-saved ${this.chunks.length} chunks to ${this.storePath} (${(fileContent.length / 1024).toFixed(1)}KB)`);
      }
      return;
    }

    if (this.pendingTxns.length === 0) return;

    const pendingRef = this.pendingTxns;
    const capturedCount = pendingRef.length;
    const appendContent = pendingRef.slice(0, capturedCount).join("");
    await appendToFile(adapter, this.storePath, appendContent);
    if (this.pendingTxns === pendingRef) {
      pendingRef.splice(0, capturedCount);
      console.info(`[VectorStore] 💾 Append-saved ${capturedCount} txns to ${this.storePath}`);
    }
  }

  addChunks(newChunks: Chunk[], notePath?: string): void {
    const path = notePath || (newChunks.length > 0 ? newChunks[0].note_path : undefined);
    if (!path) return;

    this.touchMutation();

    const oldChunkIds = this.noteToChunksMap.get(path);
    if (oldChunkIds) {
      for (const oldId of oldChunkIds) {
        this.chunksMap.delete(oldId);
        this.pendingTxns.push(JSON.stringify({ t: "del", id: oldId }) + "\n");
      }
      this.noteToChunksMap.delete(path);
    }

    if (newChunks.length > 0) {
      const newSet = new Set<string>();
      for (const c of newChunks) {
        this.chunksMap.set(c.id, c);
        newSet.add(c.id);

        const b64 = float32ArrayToBase64(new Float32Array(c.embedding));
        this.pendingTxns.push(JSON.stringify({
          t: "set",
          id: c.id,
          p: c.note_path,
          txt: c.chunk_text,
          v: b64
        }) + "\n");
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
