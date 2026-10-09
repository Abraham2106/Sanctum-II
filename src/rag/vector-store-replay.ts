import type { Chunk, VectorStoreAdapter } from "./vector-store";
import { base64ToFloat32Array, chunkToSetLine } from "./vector-store-encoding";
import { readExistingOrEmpty } from "./vector-store-io";

export type VectorSemanticOp = { kind: "replace_note"; notePath: string; chunks: readonly Chunk[] };

export type VectorReplayEntry =
  | { type: "semantic"; op: VectorSemanticOp }
  | { type: "txn"; line: string };

export function applyTxnLine(
  line: string,
  maps: {
    chunksMap: Map<string, Chunk>;
    noteToChunksMap: Map<string, Set<string>>;
    dims: number;
  }
): void {
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
        embedding,
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

export function mapsFromRaw(raw: string): {
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
    applyTxnLine(line, maps);
  }
  return maps;
}

export function cloneChunk(chunk: Chunk): Chunk {
  return {
    id: chunk.id,
    note_path: chunk.note_path,
    chunk_text: chunk.chunk_text,
    embedding: [...chunk.embedding],
  };
}

export function applyReplaceNoteSemantic(
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
    const cloned = cloneChunk(chunk);
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

export function materializeReplaceNoteTxns(
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
    lines.push(chunkToSetLine(chunk));
  }
  return lines;
}

export async function buildPersistBatchFromReplaySnapshot(
  replaySnapshot: readonly VectorReplayEntry[],
  storePath: string,
  adapter: Pick<VectorStoreAdapter, "read">
): Promise<string[]> {
  const raw = await readExistingOrEmpty(adapter, storePath);
  const staged = mapsFromRaw(raw);
  const lines: string[] = [];
  for (const entry of replaySnapshot) {
    if (entry.type === "txn") {
      lines.push(entry.line);
      applyTxnLine(entry.line, staged);
    } else {
      for (const line of materializeReplaceNoteTxns(entry.op, staged)) {
        lines.push(line);
      }
      applyReplaceNoteSemantic(entry.op, staged);
    }
  }
  return lines;
}
