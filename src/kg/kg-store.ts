import type { KgEdge } from "./types";
import { isNotFoundError } from "../core/vault-fs";
import { withResourceLock } from "../core/resource-queue";

const DEFAULT_STORE_PATH = "sanctum-logs/kg-edges.jsonl";

type KgSemanticOp =
  | { kind: "del_edge"; from: string; to: string }
  | { kind: "del_all_edges_note"; notePath: string };

type KgReplayEntry =
  | { type: "semantic"; op: KgSemanticOp }
  | { type: "txn"; line: string };

export type KgAdapter = {
  read: (p: string) => Promise<string>;
  write: (p: string, content: string) => Promise<void>;
  append?: (p: string, content: string) => Promise<void>;
};

export type KgReadAdapter = Pick<KgAdapter, "read">;

async function readExistingOrEmpty(adapter: Pick<KgAdapter, "read">, path: string): Promise<string> {
  try {
    return await adapter.read(path);
  } catch (error) {
    if (isNotFoundError(error)) return "";
    throw error;
  }
}

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

  private applyTxnLine(line: string, maps: {
    edgesMap: Map<string, KgEdge>;
    noteEdgesMap: Map<string, Set<string>>;
  }): void {
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

  private mapsFromRaw(raw: string): {
    edgesMap: Map<string, KgEdge>;
    noteEdgesMap: Map<string, Set<string>>;
  } {
    const maps = {
      edgesMap: new Map<string, KgEdge>(),
      noteEdgesMap: new Map<string, Set<string>>(),
    };
    for (const line of raw.split("\n")) {
      this.applyTxnLine(line, maps);
    }
    return maps;
  }

  private installMaps(maps: {
    edgesMap: Map<string, KgEdge>;
    noteEdgesMap: Map<string, Set<string>>;
  }): void {
    this.edgesMap = maps.edgesMap;
    this.noteEdgesMap = maps.noteEdgesMap;
  }

  private installFromRaw(raw: string): void {
    this.installMaps(this.mapsFromRaw(raw));
  }

  private enqueueTxn(line: string): void {
    this.pendingTxns.push(line);
    this.replayLog.push({ type: "txn", line });
  }

  private applySemanticOp(
    op: KgSemanticOp,
    staged: {
      edgesMap: Map<string, KgEdge>;
      noteEdgesMap: Map<string, Set<string>>;
    }
  ): void {
    if (op.kind === "del_edge") {
      const key = [op.from, op.to].sort().join("::");
      if (staged.edgesMap.has(key)) {
        this.applyTxnLine(JSON.stringify({ t: "del", from: op.from, to: op.to }), staged);
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
      this.applyTxnLine(JSON.stringify({ t: "del", from: edge.from, to: edge.to }), staged);
    }
  }

  private materializeSemanticTxns(
    op: KgSemanticOp,
    staged: {
      edgesMap: Map<string, KgEdge>;
      noteEdgesMap: Map<string, Set<string>>;
    }
  ): string[] {
    const lines: string[] = [];
    if (op.kind === "del_edge") {
      const key = [op.from, op.to].sort().join("::");
      if (staged.edgesMap.has(key)) {
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

  private async buildPersistBatchFromReplay(replayEnd: number, adapter: Pick<KgAdapter, "read">): Promise<string[]> {
    const raw = await readExistingOrEmpty(adapter, this.storePath);
    const staged = this.mapsFromRaw(raw);
    const lines: string[] = [];
    for (let i = 0; i < replayEnd; i++) {
      const entry = this.replayLog[i];
      if (entry.type === "txn") {
        lines.push(entry.line);
        this.applyTxnLine(entry.line, staged);
      } else {
        for (const line of this.materializeSemanticTxns(entry.op, staged)) {
          lines.push(line);
        }
        this.applySemanticOp(entry.op, staged);
      }
    }
    return lines;
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
        this.applySemanticOp(entry.op, staged);
      } else {
        this.applyTxnLine(entry.line, staged);
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
        const staged = this.mapsFromRaw(raw);
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
          const staged = this.mapsFromRaw("");
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
    const replayCount = replayRef.length;
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
        ? await this.buildPersistBatchFromReplay(replayCount, adapter)
        : pendingRef.slice(0, pendingCountAtCapture);
    if (appendLines.length === 0) return;

    const appendContent = appendLines.join("");
    if (typeof adapter.append === "function") {
      await adapter.append(this.storePath, appendContent);
    } else {
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
