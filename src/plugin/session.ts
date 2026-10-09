// DEC-0008: active project, threads, and index attach live outside main.
// DEC-0022: opening a project must not widen read_paths or fill empty read_paths.

import { buildProjectContext } from "../projects/context";
import type { Project } from "../projects/types";
import { ensureVaultDirectory } from "../core/vault-fs";
import { indexProject } from "../projects/indexer";
import { recomputeAllEdges } from "../kg/kg";
import { VectorStore } from "../rag/vector-store";
import { KgEdgeStore } from "../kg/kg-store";
import type { PluginHost } from "./plugin-host";
import { ProjectIndexService } from "./index-service";

export class PluginSession {
  readonly indexService: ProjectIndexService;

  constructor(private readonly host: PluginHost) {
    this.indexService = new ProjectIndexService(host.adapter);
    host.services.indexService = this.indexService;
  }

  private async ensureProjectDirectories(projectId: string): Promise<void> {
    await Promise.all([
      ensureVaultDirectory(this.host.adapter, "sanctum-projects"),
      ensureVaultDirectory(this.host.adapter, `sanctum-memory/${projectId}`),
      ensureVaultDirectory(this.host.adapter, `sanctum-logs/threads/${projectId}`),
      ensureVaultDirectory(this.host.adapter, `sanctum-logs/index/${projectId}`),
      ensureVaultDirectory(this.host.adapter, `Projects/${projectId}`),
    ]);
  }

  async initProjects(): Promise<void> {
    if (!this.host.settings.projectsEnabled) return;
    await ensureVaultDirectory(this.host.adapter, "sanctum-projects");
    const exists = await this.host.projectStore
      .projectExists(this.host.settings.activeProjectId)
      .catch(() => false);
    if (!exists) {
      await this.host.projectStore.createProject(
        this.host.settings.activeProjectId,
        this.host.settings.activeProjectId,
      );
    }
    await this.setActiveProject(this.host.settings.activeProjectId, false);
  }

  async setActiveProject(projectId: string, newThread: boolean = true): Promise<void> {
    if (!this.host.settings.projectsEnabled) return;
    try {
      await this.ensureProjectDirectories(projectId);
      const project = await this.host.projectStore.loadProject(projectId);
      const { snapshot, vectorStore, kgEdgeStore } =
        await this.indexService.loadProjectIndex(projectId);

      this.host.vectorStores.set(projectId, vectorStore);
      this.host.kgEdgeStores.set(projectId, kgEdgeStore);
      this.host.vectorStore = vectorStore;
      this.host.kgEdgeStore = kgEdgeStore;

      this.host.services.activeProject = project;
      this.host.services.activeIndexSnapshot = snapshot;
      this.host.settings.activeProjectId = projectId;
      this.host.services.activeProjectContext = await buildProjectContext(project, (id) =>
        this.host.projectStore.loadMemory(id),
      );
      if (newThread) {
        this.host.services.activeThreadId = this.host.generateThreadId();
      }
      this.host.services.refreshEmbeddingForProject();
      this.host.syncServices();
      await this.host.saveSettings();
      this.host.notice(`Proyecto activo: ${project.name}`);
      if (this.host.settings.projectReindexOnOpen) {
        await this.runProjectIndex(project);
      }
      await this.rebuildKgEdges();
      this.host.refreshChatViews();
      this.host.refreshKgViews();
    } catch (err: any) {
      this.host.notice(`Error al cambiar de proyecto: ${err.message}`, 7000);
    }
  }

  getVectorStoreForProject(projectId: string): {
    store: VectorStore;
    load: () => Promise<void>;
    save: () => Promise<void>;
  } {
    let store = this.host.vectorStores.get(projectId);
    if (!store) {
      store = new VectorStore(`sanctum-logs/index/${projectId}/generations/_inactive/vector-store.jsonl`);
      this.host.vectorStores.set(projectId, store);
    }
    const load = async () => {
      const loaded = await this.indexService.loadProjectIndex(projectId);
      this.host.vectorStores.set(projectId, loaded.vectorStore);
      this.host.services.activeIndexSnapshot = loaded.snapshot;
    };
    const save = async () => {
      await store!.save(this.host.adapter);
    };
    return { store, load, save };
  }

  getKgEdgeStoreForProject(projectId: string): {
    store: KgEdgeStore;
    load: () => Promise<void>;
    save: () => Promise<void>;
  } {
    let store = this.host.kgEdgeStores.get(projectId);
    const load = async () => {
      const loaded = await this.indexService.loadProjectIndex(projectId);
      store = loaded.kgEdgeStore;
      this.host.kgEdgeStores.set(projectId, store);
    };
    if (!store) {
      store = new KgEdgeStore(`sanctum-logs/index/${projectId}/generations/_inactive/kg-edges.jsonl`);
      this.host.kgEdgeStores.set(projectId, store);
    }
    const save = async () => {
      await store!.save(this.host.adapter);
    };
    return { store, load, save };
  }

  async rebuildKgEdges(): Promise<void> {
    const settings = this.host.settings;
    if (!settings.kgEnabled || this.host.vectorStore.count === 0) return;
    recomputeAllEdges(
      this.host.vectorStore,
      this.host.kgEdgeStore,
      { getResolvedLinks: () => this.host.app.metadataCache.resolvedLinks },
      {
        enabled: settings.kgEnabled,
        minSimilarity: settings.kgMinSimilarity,
        hops: settings.kgHops,
        maxNeighborsPerHop: 3,
        useExplicit: settings.kgUseExplicit,
        reinforceBoost: settings.kgReinforceBoost,
      },
    );
    await this.host.kgEdgeStore.save(this.host.adapter);
  }

  async runProjectIndex(project: Project, folder?: string): Promise<Awaited<ReturnType<typeof indexProject>>> {
    return indexProject(
      this.host.adapter,
      this.host.services.embedder,
      project,
      this.host.vectorStore,
      {
        paths: folder ? [folder] : undefined,
        settings: this.host.settings,
      },
    );
  }

  getActiveThreadId(): string {
    return this.host.services.activeThreadId;
  }

  getActiveProjectId(): string | null {
    return this.host.services.activeProject?.id || null;
  }

  getActiveProjectName(): string {
    return (
      this.host.services.activeProject?.name ||
      this.host.settings.activeProjectId ||
      "default"
    );
  }

  getActiveProjectIcon(): string {
    return this.host.services.activeProject?.icon || "◈";
  }

  async loadThreadMessages(threadId: string): Promise<any[]> {
    if (!this.host.services.activeProject || !threadId) return [];
    const data = await this.host.projectStore.loadThreadData(
      this.host.services.activeProject.id,
      threadId,
    );
    return data?.messages || [];
  }

  async saveThreadMessages(threadId: string, messages: any[]): Promise<void> {
    if (!this.host.services.activeProject || !threadId) return;
    await this.host.projectStore.updateThreadMessages(
      this.host.services.activeProject.id,
      threadId,
      messages,
    );
  }

  async loadThreadMessagesForProject(projectId: string, threadId: string): Promise<any[]> {
    if (!projectId || !threadId) return [];
    const data = await this.host.projectStore.loadThreadData(projectId, threadId);
    return data?.messages || [];
  }

  async loadConversationSummaryForProject(
    projectId: string,
    threadId: string,
  ): Promise<string | undefined> {
    if (!projectId || !threadId) return undefined;
    const data = await this.host.projectStore.loadThreadData(projectId, threadId);
    return data?.summary;
  }

  async saveThreadMessagesForProject(
    projectId: string,
    threadId: string,
    messages: any[],
  ): Promise<void> {
    if (!projectId || !threadId) return;
    await this.host.projectStore.updateThreadMessages(projectId, threadId, messages);
  }
}
