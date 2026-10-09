// DEC-0008: index generation load and stale batching outside main.
// DEC-0022: sealed generations; legacy rebuild_required; no auto-embed on vault events.

import type { VaultAdapter } from "../core/vault-adapter";
import { KgEdgeStore } from "../kg/kg-store";
import { VectorStore } from "../rag/vector-store";
import {
  getCachedIndexSnapshot,
  loadGenerationVectorStore,
  loadIndexGenerationSnapshot,
  markIndexStale,
  type IndexGenerationSnapshot,
} from "../projects/index-generations";

const STALE_BATCH_MS = 400;

export class ProjectIndexService {
  private pendingStale = new Set<string>();
  private staleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly adapter: VaultAdapter) {}

  async loadProjectIndex(projectId: string): Promise<{
    snapshot: IndexGenerationSnapshot;
    vectorStore: VectorStore;
    kgEdgeStore: KgEdgeStore;
  }> {
    const snapshot = await loadIndexGenerationSnapshot(this.adapter, projectId);
    if (snapshot.status === "ready" && snapshot.generationId) {
      const store =
        (await loadGenerationVectorStore(this.adapter, projectId, snapshot.generationId)) ??
        new VectorStore(snapshot.vectorStorePath ?? `sanctum-logs/index/${projectId}/vector-store.jsonl`);
      const kgPath =
        snapshot.kgEdgesPath ??
        `sanctum-logs/index/${projectId}/generations/${snapshot.generationId}/kg-edges.jsonl`;
      const kgEdgeStore = new KgEdgeStore(kgPath);
      await kgEdgeStore.load(this.adapter).catch(() => undefined);
      return { snapshot, vectorStore: store, kgEdgeStore };
    }

    const emptyVectorPath = `sanctum-logs/index/${projectId}/generations/_inactive/vector-store.jsonl`;
    const vectorStore = new VectorStore(emptyVectorPath);
    const kgEdgeStore = new KgEdgeStore(
      `sanctum-logs/index/${projectId}/generations/_inactive/kg-edges.jsonl`,
    );
    return { snapshot, vectorStore, kgEdgeStore };
  }

  getSnapshot(projectId: string): IndexGenerationSnapshot | undefined {
    return getCachedIndexSnapshot(projectId);
  }

  /** Queue stale mark; never triggers embedding/index build. */
  scheduleStale(projectId: string): void {
    if (!projectId) return;
    this.pendingStale.add(projectId);
    if (this.staleTimer) return;
    this.staleTimer = setTimeout(() => {
      void this.flushStaleMarks();
    }, STALE_BATCH_MS);
  }

  async flushStaleMarks(): Promise<void> {
    this.staleTimer = null;
    const ids = [...this.pendingStale];
    this.pendingStale.clear();
    await Promise.all(ids.map((id) => markIndexStale(this.adapter, id).catch(() => undefined)));
  }

  onVaultNoteEvent(projectId: string | null | undefined): void {
    if (!projectId) return;
    this.scheduleStale(projectId);
  }
}
