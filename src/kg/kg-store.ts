import type { KgEdge } from "./types";
import { isNotFoundError } from "../core/vault-fs";
import { withResourceLock } from "../core/resource-queue";

const DEFAULT_STORE_PATH = "sanctum-logs/kg-edges.jsonl";

type KgAdapter = {
  read: (p: string) => Promise<string>;
  write: (p: string, content: string) => Promise<void>;
  append?: (p: string, content: string) => Promise<void>;
};

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

  private installFromRaw(raw: string): void {
    const lines = raw.split("\n");
    this.edgesMap.clear();
    this.noteEdgesMap.clear();

    for (const line of lines) {
      if (!line.trim()) continue;
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
          this.edgesMap.set(key, edge);

          for (const np of [txn.from, txn.to]) {
            let set = this.noteEdgesMap.get(np);
            if (!set) {
              set = new Set();
              this.noteEdgesMap.set(np, set);
            }
            set.add(key);
          }
        } else if (txn.t === "del") {
          const key = [txn.from, txn.to].sort().join("::");
          const old = this.edgesMap.get(key);
          if (old) {
            for (const np of [old.from, old.to]) {
              const set = this.noteEdgesMap.get(np);
              if (set) {
                set.delete(key);
                if (set.size === 0) this.noteEdgesMap.delete(np);
              }
            }
            this.edgesMap.delete(key);
          }
        }
      } catch (e) {
        console.warn("Error parsing edge transaction:", e);
      }
    }
  }

  private resetMapsToEmpty(): void {
    this.edgesMap.clear();
    this.noteEdgesMap.clear();
  }

  async load(adapter: KgAdapter): Promise<void> {
    const epochAtStart = this.mutationEpoch;
    await withResourceLock(adapter, this.storePath, () => this.loadUnlocked(adapter, epochAtStart));
  }

  private async loadUnlocked(adapter: KgAdapter, epochAtStart: number): Promise<void> {
    try {
      const raw = await adapter.read(this.storePath);
      if (this.mutationEpoch !== epochAtStart) {
        this.shouldTruncate = true;
        return;
      }
      this.installFromRaw(raw);
      this.pendingTxns = [];
      this.shouldTruncate = false;
    } catch (error) {
      if (isNotFoundError(error)) {
        if (this.mutationEpoch === epochAtStart) {
          this.resetMapsToEmpty();
          this.pendingTxns = [];
          this.shouldTruncate = false;
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
    if (this.shouldTruncate) {
      const pendingRef = this.pendingTxns;
      const pendingBefore = pendingRef.length;
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
        pendingRef.splice(0, pendingBefore);
      }
      return;
    }

    if (this.pendingTxns.length === 0) return;

    const pendingRef = this.pendingTxns;
    const capturedCount = pendingRef.length;
    const appendContent = pendingRef.slice(0, capturedCount).join("");
    if (typeof adapter.append === "function") {
      await adapter.append(this.storePath, appendContent);
    } else {
      const existing = await readExistingOrEmpty(adapter, this.storePath);
      await adapter.write(this.storePath, existing + appendContent);
    }
    if (this.pendingTxns === pendingRef) {
      pendingRef.splice(0, capturedCount);
    }
  }

  addEdge(edge: KgEdge): void {
    const key = [edge.from, edge.to].sort().join("::");
    const old = this.edgesMap.get(key);
    if (old) {
      if (old.type === edge.type && old.weight === edge.weight && old.relation === edge.relation) return;
      this.pendingTxns.push(JSON.stringify({ t: "del", from: old.from, to: old.to }) + "\n");
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
    this.pendingTxns.push(JSON.stringify({
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
    if (!old) return;

    this.touchMutation();
    this.edgesMap.delete(key);
    this.pendingTxns.push(JSON.stringify({ t: "del", from, to }) + "\n");

    for (const np of [old.from, old.to]) {
      const set = this.noteEdgesMap.get(np);
      if (set) {
        set.delete(key);
        if (set.size === 0) this.noteEdgesMap.delete(np);
      }
    }
  }

  delAllEdgesForNote(notePath: string): void {
    const keys = this.noteEdgesMap.get(notePath);
    if (!keys) return;
    for (const key of keys) {
      const edge = this.edgesMap.get(key);
      if (edge) {
        const other = edge.from === notePath ? edge.to : edge.from;
        this.delEdge(notePath, other);
      }
    }
  }

  clear(): void {
    this.touchMutation();
    this.edgesMap.clear();
    this.noteEdgesMap.clear();
    this.pendingTxns = [];
    this.shouldTruncate = true;
  }
}
