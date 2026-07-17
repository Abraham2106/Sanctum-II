import type { VaultAdapter } from "../core/vault-adapter";
import type { VectorStore } from "../rag/vector-store";
import type { ProjectStore } from "./store";
import type { Project } from "./types";
import { indexProject, isProjectPathAllowed, type EmbeddingProvider, type IndexChange, type IndexResult } from "./indexer";

export interface IndexCoordinatorStatus {
  projectId: string;
  state: "queued" | "indexing" | "indexed" | "waiting-for-keys" | "error";
  pending: number;
  result?: IndexResult;
  error?: string;
}

export interface IncrementalIndexCoordinatorOptions {
  adapter: VaultAdapter;
  projectStore: ProjectStore;
  getVectorStore(projectId: string): VectorStore;
  getEmbeddingProvider(): EmbeddingProvider;
  canEmbed(): boolean;
  debounceMs?: number;
  onStatus?(status: IndexCoordinatorStatus): void;
  onIndexed?(project: Project, result: IndexResult): void | Promise<void>;
}

type PendingOperation = "upsert" | "delete";

/** Coordinates vault events, project boundaries and serialized incremental indexing. */
export class IncrementalIndexCoordinator {
  private pending = new Map<string, Map<string, PendingOperation>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private loadedStores = new Set<string>();
  private readonly debounceMs: number;

  constructor(private readonly options: IncrementalIndexCoordinatorOptions) {
    this.debounceMs = options.debounceMs ?? 1500;
  }

  async queueChange(change: IndexChange): Promise<void> {
    const projects = await this.loadValidProjects();
    for (const { id, project } of projects) {
      const oldPath = change.type === "rename" ? change.oldPath : change.path;
      const newPath = change.path;
      const oldAllowed = isProjectPathAllowed(oldPath, project);
      const newAllowed = change.type === "delete" ? false : isProjectPathAllowed(newPath, project);
      if (!oldAllowed && !newAllowed) continue;

      if (change.type === "rename") {
        if (oldAllowed) this.setPending(id, oldPath, "delete");
        if (newAllowed) this.setPending(id, newPath, "upsert");
      } else if (change.type === "delete") {
        if (oldAllowed) this.setPending(id, oldPath, "delete");
      } else if (newAllowed) {
        this.setPending(id, newPath, "upsert");
      }
      this.schedule(id);
    }
  }

  async reconcileAll(): Promise<void> {
    const projects = await this.loadValidProjects();
    for (const { id } of projects) {
      try {
        await this.reconcileProject(id);
      } catch (error: any) {
        this.emit(id, "error", undefined, error?.message || String(error));
      }
    }
  }

  private async loadValidProjects(): Promise<{ id: string; project: Project }[]> {
    if (typeof (this.options.projectStore as any).listValidProjects === "function") {
      return (this.options.projectStore as any).listValidProjects();
    }
    const ids = await this.options.projectStore.listProjects();
    const valid: { id: string; project: Project }[] = [];
    for (const id of ids) {
      try {
        valid.push({ id, project: await this.options.projectStore.loadProject(id) });
      } catch (error: any) {
        this.emit(id, "error", undefined, error?.message || String(error));
      }
    }
    return valid;
  }

  async reconcileProject(projectId: string): Promise<IndexResult | undefined> {
    let project: Project;
    try {
      project = await this.options.projectStore.loadProject(projectId);
    } catch (error: any) {
      this.emit(projectId, "error", undefined, error?.message || String(error));
      return undefined;
    }
    if (!this.options.canEmbed()) {
      this.emit(projectId, "waiting-for-keys");
      return undefined;
    }
    const store = await this.getLoadedStore(projectId);
    this.emit(projectId, "indexing");
    try {
      const result = await indexProject(this.options.adapter as any, this.options.getEmbeddingProvider(), project, store);
      this.emit(projectId, "indexed", result);
      await this.options.onIndexed?.(project, result);
      return result;
    } catch (error: any) {
      this.emit(projectId, "error", undefined, error?.message || String(error));
      throw error;
    }
  }

  /** Flushes debounced work immediately; useful before a query and in tests. */
  async flushPending(projectId?: string): Promise<void> {
    if (projectId) {
      await this.flushProject(projectId);
      return;
    }
    for (const id of [...this.pending.keys()]) await this.flushProject(id);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private setPending(projectId: string, path: string, operation: PendingOperation): void {
    let operations = this.pending.get(projectId);
    if (!operations) {
      operations = new Map();
      this.pending.set(projectId, operations);
    }
    operations.set(path.replace(/\\/g, "/").replace(/^\/+/, ""), operation);
    this.emit(projectId, "queued");
  }

  private schedule(projectId: string): void {
    const current = this.timers.get(projectId);
    if (current) clearTimeout(current);
    this.timers.set(projectId, setTimeout(() => {
      this.timers.delete(projectId);
      void this.flushProject(projectId);
    }, this.debounceMs));
  }

  private async flushProject(projectId: string): Promise<void> {
    const timer = this.timers.get(projectId);
    if (timer) clearTimeout(timer);
    this.timers.delete(projectId);
    const operations = this.pending.get(projectId);
    if (!operations?.size) return;
    if (!this.options.canEmbed() && [...operations.values()].some(value => value === "upsert")) {
      this.emit(projectId, "waiting-for-keys");
      return;
    }

    this.pending.delete(projectId);
    const changes: IndexChange[] = [...operations].map(([path, type]) => ({ type, path }));
    try {
      const project = await this.options.projectStore.loadProject(projectId);
      const store = await this.getLoadedStore(projectId);
      this.emit(projectId, "indexing");
      const result = await indexProject(this.options.adapter as any, this.options.getEmbeddingProvider(), project, store, { changes });
      this.emit(projectId, "indexed", result);
      await this.options.onIndexed?.(project, result);
    } catch (error: any) {
      const restored = this.pending.get(projectId) || new Map<string, PendingOperation>();
      for (const [path, operation] of operations) if (!restored.has(path)) restored.set(path, operation);
      this.pending.set(projectId, restored);
      this.emit(projectId, "error", undefined, error?.message || String(error));
    }
  }

  private async getLoadedStore(projectId: string): Promise<VectorStore> {
    const store = this.options.getVectorStore(projectId);
    if (!this.loadedStores.has(projectId)) {
      await store.load(this.options.adapter);
      this.loadedStores.add(projectId);
    }
    return store;
  }

  private emit(projectId: string, state: IndexCoordinatorStatus["state"], result?: IndexResult, error?: string): void {
    this.options.onStatus?.({ projectId, state, result, error, pending: this.pending.get(projectId)?.size || 0 });
  }
}
