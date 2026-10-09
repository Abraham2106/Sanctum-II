import type { KgEdge } from "./types";
import { isNotFoundError } from "../core/vault-fs";
import { withResourceLock } from "../core/resource-queue";
import {
  kgAdapterHasRead,
  readExistingOrEmpty,
  type KgPersistAdapter,
} from "./kg-store-io";
import {
  applySemanticOp,
  applyTxnLine,
  buildPersistBatchFromReplaySnapshot,
  mapsFromRaw,
  type KgReplayEntry,
} from "./kg-store-replay";

const DEFAULT_STORE_PATH = "sanctum-logs/kg-edges.jsonl";

export type KgAdapter = KgPersistAdapter;

export type KgReadAdapter = { read: (p: string) => Promise<string> };

export class KgEdgeStore {
  constructor(private storePath: string = DEFAULT_STORE_PATH) {}
  private edgesMap = new Map<string, KgEdge>();
  private noteEdgesMap = new Map<string, Set<string>>();
  private pendingTxns: string[] = [];
  private replayLog: KgReplayEntry[] = [];
  private shouldTruncate = false;
  private mutationEpoch = 0;

  private touchMutation(): void {
    this.mutationEpoch++;
  }

  get count(): number {
    return this.edgesMap.size;
  }

  getAllEdges(): KgEdge[] {
    return [...this.edgesMap.values()];
  }

  /** Returns an immutable-in-practice copy for an in-flight request. */
  snapshot(): KgEdgeStore {
    const copy = new KgEdgeStore();
    for (const edge of this.edgesMap.values()) {
      const key = [edge.from, edge.to].sort().join("::");
      copy.edgesMap.set(key, { ...edge });
      for (const notePath of [edge.from, edge.to]) {
        let keys = copy.noteEdgesMap.get(notePath);
        if (!keys) {
          keys = new Set<string>();
          copy.noteEdgesMap.set(notePath, keys);
        }
        keys.add(key);
      }
    }
    return copy;
  }

  getEdgesForNote(notePath: string): KgEdge[] {
    const keys = this.noteEdgesMap.get(notePath);
    if (!keys) return [];
    const edges: KgEdge[] = [];
    for (const key of keys) {
      const e = this.edgesMap.get(key);
      if (e) edges.push(e);
    }
    return edges;
  }

  getEdge(from: string, to: string): KgEdge | undefined {
    const key = [from, to].sort().join("::");
    return this.edgesMap.get(key);
  }

  private installMaps(maps: {
    edgesMap: Map<string, KgEdge>;
    noteEdgesMap: Map<string, Set<string>>;
  }): void {
    this.edgesMap = maps.edgesMap;
    this.noteEdgesMap = maps.noteEdgesMap;
  }

  private installFromRaw(raw: string): void {
    this.installMaps(mapsFromRaw(raw));
  }

  private enqueueTxn(line: string): void {
    this.pendingTxns.push(line);
    this.replayLog.push({ type: "txn", line });
  }

  private retirePersistedPrefix(
    replayRef: KgReplayEntry[],
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
    edgesMap: Map<string, KgEdge>;
    noteEdgesMap: Map<string, Set<string>>;
  }): void {
    for (const entry of this.replayLog) {
      if (entry.type === "semantic") {
        applySemanticOp(entry.op, staged);
      } else {
        applyTxnLine(entry.line, staged);
      }
    }
  }

  private resetMapsToEmpty(): void {
    this.edgesMap.clear();
    this.noteEdgesMap.clear();
  }

  async load(adapter: KgReadAdapter): Promise<void> {
    const epochAtStart = this.mutationEpoch;
    await withResourceLock(adapter, this.storePath, () => this.loadUnlocked(adapter, epochAtStart));
  }

  private async loadUnlocked(adapter: KgReadAdapter, epochAtStart: number): Promise<void> {
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
        return;
      }
      throw error;
    }
  }

  async save(adapter: KgAdapter): Promise<void> {
    await withResourceLock(adapter, this.storePath, () => this.saveUnlocked(adapter));
  }

  private async saveUnlocked(adapter: KgAdapter): Promise<void> {
    const replayRef = this.replayLog;
    const replaySnapshot = replayRef.slice();
    const replayCount = replaySnapshot.length;
    const pendingRef = this.pendingTxns;
    const pendingCountAtCapture = pendingRef.length;

    if (this.shouldTruncate) {
      const txns: string[] = [];
      for (const edge of this.edgesMap.values()) {
        txns.push(JSON.stringify({
          t: "set", from: edge.from, to: edge.to,
          typ: edge.type, w: edge.weight, r: edge.relation,
        }));
      }
      const content = txns.length > 0 ? txns.join("\n") + "\n" : "";
      await adapter.write(this.storePath, content);
      if (this.pendingTxns === pendingRef) {
        this.shouldTruncate = false;
        this.retirePersistedPrefix(replayRef, replayCount, pendingRef, pendingCountAtCapture);
      }
      return;
    }

    const appendLines =
      replayCount > 0
        ? await buildPersistBatchFromReplaySnapshot(replaySnapshot, this.storePath, adapter)
        : pendingRef.slice(0, pendingCountAtCapture);
    if (appendLines.length === 0) return;

    const appendContent = appendLines.join("");
    if (typeof adapter.append === "function") {
      await adapter.append(this.storePath, appendContent);
    } else {
      if (!kgAdapterHasRead(adapter)) {
        throw new Error("KgEdgeStore save requires read adapter when append is unavailable");
      }
      const existing = await readExistingOrEmpty(adapter, this.storePath);
      await adapter.write(this.storePath, existing + appendContent);
    }
    if (this.pendingTxns === pendingRef) {
      this.retirePersistedPrefix(replayRef, replayCount, pendingRef, pendingCountAtCapture);
    }
  }

  addEdge(edge: KgEdge): void {
    const key = [edge.from, edge.to].sort().join("::");
    const old = this.edgesMap.get(key);
    if (old) {
      if (old.type === edge.type && old.weight === edge.weight && old.relation === edge.relation) return;
      this.enqueueTxn(JSON.stringify({ t: "del", from: old.from, to: old.to }) + "\n");
      for (const np of [old.from, old.to]) {
        const set = this.noteEdgesMap.get(np);
        if (set) {
          set.delete(key);
          if (set.size === 0) this.noteEdgesMap.delete(np);
        }
      }
    }

    this.touchMutation();
    this.edgesMap.set(key, edge);
    this.enqueueTxn(JSON.stringify({
      t: "set", from: edge.from, to: edge.to,
      typ: edge.type, w: edge.weight, r: edge.relation,
    }) + "\n");

    for (const np of [edge.from, edge.to]) {
      let set = this.noteEdgesMap.get(np);
      if (!set) {
        set = new Set();
        this.noteEdgesMap.set(np, set);
      }
      set.add(key);
    }
  }

  delEdge(from: string, to: string): void {
    const key = [from, to].sort().join("::");
    const old = this.edgesMap.get(key);

    this.touchMutation();
    this.replayLog.push({ type: "semantic", op: { kind: "del_edge", from, to } });

    if (!old) return;

    this.edgesMap.delete(key);
    for (const np of [old.from, old.to]) {
      const set = this.noteEdgesMap.get(np);
      if (set) {
        set.delete(key);
        if (set.size === 0) this.noteEdgesMap.delete(np);
      }
    }
  }

  delAllEdgesForNote(notePath: string): void {
    this.touchMutation();
    this.replayLog.push({ type: "semantic", op: { kind: "del_all_edges_note", notePath } });

    const keys = this.noteEdgesMap.get(notePath);
    if (!keys) return;
    for (const key of [...keys]) {
      const edge = this.edgesMap.get(key);
      if (!edge) continue;
      this.edgesMap.delete(key);
      for (const np of [edge.from, edge.to]) {
        const set = this.noteEdgesMap.get(np);
        if (set) {
          set.delete(key);
          if (set.size === 0) this.noteEdgesMap.delete(np);
        }
      }
    }
  }

  clear(): void {
    this.touchMutation();
    this.edgesMap.clear();
    this.noteEdgesMap.clear();
    this.pendingTxns = [];
    this.replayLog = [];
    this.shouldTruncate = true;
  }
}
