export interface Chunk {
  id: string;
  note_path: string;
  chunk_text: string;
  embedding: number[];
}

const STORE_PATH = "sanctum-logs/vector-store.jsonl";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
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

async function appendToFile(
  adapter: any,
  path: string,
  content: string
): Promise<void> {
  if (typeof adapter.append === "function") {
    await adapter.append(path, content);
  } else {
    let existing = "";
    if (typeof adapter.exists === "function" ? await adapter.exists(path) : true) {
      try {
        existing = await adapter.read(path);
      } catch {}
    }
    await adapter.write(path, existing ? `${existing}${content}` : content);
  }
}

export class VectorStore {
  private chunksMap = new Map<string, Chunk>();
  private noteToChunksMap = new Map<string, Set<string>>();
  private chunks: Chunk[] = [];
  private pendingTxns: string[] = [];
  private shouldTruncate = false;
  private dims = 0;

  get count(): number {
    return this.chunks.length;
  }

  async load(adapter: { read: (p: string) => Promise<string> }): Promise<void> {
    try {
      const raw = await adapter.read(STORE_PATH);
      const lines = raw.split("\n");
      
      this.chunksMap.clear();
      this.noteToChunksMap.clear();

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

            // Track note to chunks mapping
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
          console.warn("Error parsing transaction line in vector store log:", e);
        }
      }
      this.chunks = Array.from(this.chunksMap.values());
    } catch {
      this.chunksMap.clear();
      this.noteToChunksMap.clear();
      this.chunks = [];
    }
  }

  async save(adapter: { write: (p: string, content: string) => Promise<void> }): Promise<void> {
    if (this.shouldTruncate) {
      // Compaction / Truncation: rewrite the active state cleanly
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
      await adapter.write(STORE_PATH, fileContent);
      this.shouldTruncate = false;
      this.pendingTxns = [];
    } else if (this.pendingTxns.length > 0) {
      const appendContent = this.pendingTxns.join("") ;
      await appendToFile(adapter, STORE_PATH, appendContent);
      this.pendingTxns = [];
    }
  }

  addChunks(newChunks: Chunk[], notePath?: string): void {
    const path = notePath || (newChunks.length > 0 ? newChunks[0].note_path : undefined);
    if (!path) return;

    // Delete any old chunks for this note (Tombstones)
    const oldChunkIds = this.noteToChunksMap.get(path);
    if (oldChunkIds) {
      for (const oldId of oldChunkIds) {
        this.chunksMap.delete(oldId);
        this.pendingTxns.push(JSON.stringify({ t: "del", id: oldId }) + "\n");
      }
      this.noteToChunksMap.delete(path);
    }

    // Add new chunks (Inserts/Updates)
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

    // Rebuild active array for searches
    this.chunks = Array.from(this.chunksMap.values());
  }

  clear(): void {
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
    if (allowedPaths.length === 0) return results;
    return results.filter((r) => {
      if (allowedPaths.includes("/**") || allowedPaths.includes("**")) return true;
      return allowedPaths.some((p) => {
        const pat = p.startsWith("/") ? p.slice(1) : p;
        if (pat === "**" || pat === "") return true;
        return new RegExp(
          "^" + pat
            .replace(/\*\*/g, "___DS___")
            .replace(/\*/g, "[^/]*")
            .replace(/___DS___/g, ".*")
            .replace(/\//g, "\\/")
            .replace(/\./g, "\\.")
        ).test(r.chunk.note_path);
      });
    });
  }
}

