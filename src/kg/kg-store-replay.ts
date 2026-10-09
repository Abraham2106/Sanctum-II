import type { KgEdge } from "./types";
import {
  kgAdapterHasRead,
  KgPersistRequiresReadError,
  readExistingOrEmpty,
  type KgPersistAdapter,
} from "./kg-store-io";

export type KgSemanticOp =
  | { kind: "del_edge"; from: string; to: string }
  | { kind: "del_all_edges_note"; notePath: string };

export type KgReplayEntry =
  | { type: "semantic"; op: KgSemanticOp }
  | { type: "txn"; line: string };

export function applyTxnLine(
  line: string,
  maps: {
    edgesMap: Map<string, KgEdge>;
    noteEdgesMap: Map<string, Set<string>>;
  }
): void {
  if (!line.trim()) return;
  try {
    const txn = JSON.parse(line);
    if (txn.t === "set") {
      const edge: KgEdge = {
        from: txn.from,
        to: txn.to,
        type: txn.typ,
        weight: txn.w,
        relation: txn.r,
      };
      const key = [txn.from, txn.to].sort().join("::");
      maps.edgesMap.set(key, edge);

      for (const np of [txn.from, txn.to]) {
        let set = maps.noteEdgesMap.get(np);
        if (!set) {
          set = new Set();
          maps.noteEdgesMap.set(np, set);
        }
        set.add(key);
      }
    } else if (txn.t === "del") {
      const key = [txn.from, txn.to].sort().join("::");
      const old = maps.edgesMap.get(key);
      if (old) {
        for (const np of [old.from, old.to]) {
          const set = maps.noteEdgesMap.get(np);
          if (set) {
            set.delete(key);
            if (set.size === 0) maps.noteEdgesMap.delete(np);
          }
        }
        maps.edgesMap.delete(key);
      }
    }
  } catch (e) {
    console.warn("Error parsing edge transaction:", e);
  }
}

export function mapsFromRaw(raw: string): {
  edgesMap: Map<string, KgEdge>;
  noteEdgesMap: Map<string, Set<string>>;
} {
  const maps = {
    edgesMap: new Map<string, KgEdge>(),
    noteEdgesMap: new Map<string, Set<string>>(),
  };
  for (const line of raw.split("\n")) {
    applyTxnLine(line, maps);
  }
  return maps;
}

export function applySemanticOp(
  op: KgSemanticOp,
  staged: {
    edgesMap: Map<string, KgEdge>;
    noteEdgesMap: Map<string, Set<string>>;
  }
): void {
  if (op.kind === "del_edge") {
    const key = [op.from, op.to].sort().join("::");
    if (staged.edgesMap.has(key)) {
      applyTxnLine(JSON.stringify({ t: "del", from: op.from, to: op.to }), staged);
    }
    return;
  }

  const toRemove: KgEdge[] = [];
  for (const edge of staged.edgesMap.values()) {
    if (edge.from === op.notePath || edge.to === op.notePath) {
      toRemove.push(edge);
    }
  }
  for (const edge of toRemove) {
    applyTxnLine(JSON.stringify({ t: "del", from: edge.from, to: edge.to }), staged);
  }
}

export function materializeSemanticTxns(
  op: KgSemanticOp,
  staged: {
    edgesMap: Map<string, KgEdge>;
    noteEdgesMap: Map<string, Set<string>>;
  },
  appendOnlyNoRead: boolean
): string[] {
  const lines: string[] = [];
  if (op.kind === "del_edge") {
    const key = [op.from, op.to].sort().join("::");
    if (appendOnlyNoRead || staged.edgesMap.has(key)) {
      lines.push(JSON.stringify({ t: "del", from: op.from, to: op.to }) + "\n");
    }
    return lines;
  }
  for (const edge of [...staged.edgesMap.values()]) {
    if (edge.from === op.notePath || edge.to === op.notePath) {
      lines.push(JSON.stringify({ t: "del", from: edge.from, to: edge.to }) + "\n");
    }
  }
  return lines;
}

function replaySnapshotNeedsBaselineRead(replaySnapshot: readonly KgReplayEntry[]): boolean {
  return replaySnapshot.some(
    (entry) => entry.type === "semantic" && entry.op.kind === "del_all_edges_note"
  );
}

export async function buildPersistBatchFromReplaySnapshot(
  replaySnapshot: readonly KgReplayEntry[],
  storePath: string,
  adapter: KgPersistAdapter
): Promise<string[]> {
  const appendOnlyNoRead = !kgAdapterHasRead(adapter);
  if (appendOnlyNoRead && replaySnapshotNeedsBaselineRead(replaySnapshot)) {
    throw new KgPersistRequiresReadError(
      "KgEdgeStore save requires a read adapter to persist delAllEdgesForNote against disk baseline"
    );
  }

  const raw = kgAdapterHasRead(adapter)
    ? await readExistingOrEmpty(adapter, storePath)
    : "";
  const staged = mapsFromRaw(raw);
  const lines: string[] = [];
  for (const entry of replaySnapshot) {
    if (entry.type === "txn") {
      lines.push(entry.line);
      applyTxnLine(entry.line, staged);
    } else {
      for (const line of materializeSemanticTxns(entry.op, staged, appendOnlyNoRead)) {
        lines.push(line);
      }
      applySemanticOp(entry.op, staged);
    }
  }
  return lines;
}
