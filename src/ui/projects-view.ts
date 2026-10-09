import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { Project, Thread, MemoryEntry } from "../projects/types";
import { ProjectStore } from "../projects/store";
import { indexProject } from "../projects/indexer";
import { ingestProjectFile, openFilePicker } from "./projects/project-files";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { VectorStore } from "../rag/vector-store";
import type { VaultAdapter } from "../core/vault-adapter";
import { InputModal } from "./input-modal";
import { FolderSelectModal } from "./folder-select-modal";
import type { IndexGenerationSnapshot } from "../projects/index-generations";
import { renderProjectsLeft } from "./projects/projects-view-left";
import { renderProjectsCenter } from "./projects/projects-view-center";
import { renderProjectsRight } from "./projects/projects-view-right";
import { showProjectMenu, showThreadMenu, type ProjectsMenuHost } from "./projects/projects-view-menus";

export const VIEW_TYPE_PROJECTS = "sanctum-projects";

export interface ProjectsViewDeps {
  projectStore: ProjectStore;
  geminiBalancer: GeminiBalancer;
  getActiveProjectId: () => string;
  getVectorStore: (projectId: string) => { store: VectorStore; load: () => Promise<void>; save: () => Promise<void> };
  vaultAdapter: VaultAdapter;
  onSelectProject: (id: string) => Promise<void>;
  onOpenThread: (message: string, threadId?: string) => Promise<void>;
  loadMemory: (id: string) => Promise<MemoryEntry[]>;
  appendMemory: (text: string, source?: string) => Promise<void>;
  saveProject: (p: Project) => Promise<void>;
  getVectorCount: (id: string) => number;
  getIndexSnapshot?: (projectId: string) => IndexGenerationSnapshot | null;
}

export class ProjectsView extends ItemView {
  private projects: Project[] = [];
  private activeProject: Project | null = null;
  private threads: Thread[] = [];
  private memory: MemoryEntry[] = [];
  private leftEl!: HTMLElement;
  private centerEl!: HTMLElement;
  private rightEl!: HTMLElement;
  private composerInput!: HTMLTextAreaElement;
  private activeMenu: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: ProjectsViewDeps) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_PROJECTS; }
  getDisplayText(): string { return "Proyectos"; }
  getIcon(): string { return "folders"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("sanctum-root");
    container.addClass("sanctum-projects-view");
    container.style.height = "100%";

    this.leftEl = container.createDiv({ cls: "s-proj-left" });
    this.centerEl = container.createDiv({ cls: "s-center" });
    this.rightEl = container.createDiv({ cls: "s-proj-right" });

    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.loadProjects();
    await this.loadActiveProject();
    this.renderLeft();
    this.renderCenter();
    this.renderRight();
  }

  applyActiveProject(project: Project | null, threads: Thread[], memory: MemoryEntry[]): void {
    this.activeProject = project;
    this.threads = threads;
    this.memory = memory;
    this.renderLeft();
    this.renderCenter();
    this.renderRight();
  }

  private async loadProjects(): Promise<void> {
    const ids = await this.deps.projectStore.listProjects();
    this.projects = [];
    for (const id of ids) {
      try { this.projects.push(await this.deps.projectStore.loadProject(id)); } catch {}
    }
  }

  private async loadActiveProject(): Promise<void> {
    const pid = this.deps.getActiveProjectId();
    try {
      this.activeProject = await this.deps.projectStore.loadProject(pid);
      this.threads = await this.deps.projectStore.loadThreads(pid);
      this.memory = await this.deps.loadMemory(pid);
    } catch {
      this.activeProject = null;
      this.threads = [];
      this.memory = [];
    }
  }

  private menuHost(): ProjectsMenuHost {
    return {
      app: this.app,
      projectStore: this.deps.projectStore,
      getActiveProjectId: () => this.deps.getActiveProjectId(),
      getActiveProject: () => this.activeProject,
      clearActiveProject: () => {
        this.activeProject = null;
        this.threads = [];
        this.memory = [];
      },
      getThreads: () => this.threads,
      setThreads: (threads) => { this.threads = threads; },
      saveProject: (p) => this.deps.saveProject(p),
      onRefresh: () => this.refresh(),
      renderLeft: () => this.renderLeft(),
      renderCenter: () => this.renderCenter(),
      getActiveMenu: () => this.activeMenu,
      setActiveMenu: (menu) => { this.activeMenu = menu; },
    };
  }

  private renderLeft(): void {
    renderProjectsLeft({
      leftEl: this.leftEl,
      projects: this.projects,
      getActiveProjectId: () => this.deps.getActiveProjectId(),
      onSelectProject: (id) => this.deps.onSelectProject(id),
      onRefresh: () => this.refresh(),
      onCreateProject: () => void this.createProject(),
      onProjectMenu: (anchor, project) => showProjectMenu(this.menuHost(), anchor, project),
    });
  }

  private renderCenter(): void {
    renderProjectsCenter({
      centerEl: this.centerEl,
      activeProject: this.activeProject,
      threads: this.threads,
      memoryCount: this.memory.length,
      getVectorCount: (id) => this.deps.getVectorCount(id),
      saveProject: (p) => void this.deps.saveProject(p),
      onOpenThread: (message, threadId) => this.deps.onOpenThread(message, threadId),
      onThreadMenu: (anchor, thread) => showThreadMenu(this.menuHost(), anchor, thread),
      setComposerInput: (el) => { this.composerInput = el; },
    });
  }

  private renderRight(): void {
    renderProjectsRight({
      app: this.app,
      rightEl: this.rightEl,
      activeProject: this.activeProject,
      memory: this.memory,
      getVectorCount: (id) => this.deps.getVectorCount(id),
      getIndexSnapshot: this.deps.getIndexSnapshot,
      saveProject: (p) => this.deps.saveProject(p),
      onAddFolder: () => this.addFolder(),
      onAddMemory: () => void this.addMemory(),
      onReindex: () => this.reindex(),
      onAddFile: () => void this.addFile(),
      onDrop: (e) => void this.handleDrop(e),
      onRenderRight: () => this.renderRight(),
      setActiveProject: (p) => { this.activeProject = p; },
    });
  }

  private async createProject(): Promise<void> {
    const modal = new InputModal(this.app, "Nuevo proyecto", "ID del proyecto (sin espacios)", "nuevo-proyecto");
    const parts = await modal.ask();
    if (!parts) return;
    const id = parts.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
    if (!id) { new Notice("ID inválido"); return; }
    const nameModal = new InputModal(this.app, "Nombre visible", "Nombre", id);
    const name = await nameModal.ask();
    await this.deps.projectStore.createProject(id, name || id);
    new Notice(`Proyecto "${name || id}" creado`);
    await this.refresh();
  }

  private addFolder(): void {
    if (!this.activeProject) return;
    new FolderSelectModal(this.app, (path) => {
      if (!this.activeProject) return;
      const clean = path.replace(/\\/g, "/");
      if (!this.activeProject.read_paths.includes(clean)) {
        this.activeProject.read_paths.push(clean);
      }
      void this.deps.saveProject(this.activeProject);
      this.renderRight();
    }).open();
  }

  private async addMemory(): Promise<void> {
    const modal = new InputModal(this.app, "Nueva memoria", "Hecho o decisión persistente");
    const text = await modal.ask();
    if (!text) return;
    await this.deps.appendMemory(text, "manual");
    await this.refresh();
  }

  private async reindex(): Promise<void> {
    if (!this.activeProject) return;
    try {
      const { store } = this.deps.getVectorStore(this.activeProject.id);
      await indexProject(this.deps.vaultAdapter, this.deps.geminiBalancer, this.activeProject, store);
      new Notice(`Proyecto "${this.activeProject.name}" reindexado`);
      await this.refresh();
    } catch (err: unknown) {
      new Notice("Error al reindexar: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async addFile(): Promise<void> {
    openFilePicker(async (files) => {
      if (!this.activeProject) return;
      for (const file of files) {
        try {
          await ingestProjectFile(this.app, this.activeProject, file, (p) => this.deps.saveProject(p));
        } catch (err: unknown) {
          new Notice(`Error al adjuntar ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.renderRight();
    });
  }

  private async handleDrop(e: DragEvent): Promise<void> {
    const files = e.dataTransfer?.files;
    if (!files || !this.activeProject) return;
    for (let i = 0; i < files.length; i++) {
      try {
        await ingestProjectFile(this.app, this.activeProject, files[i], (p) => this.deps.saveProject(p));
      } catch (err: unknown) {
        new Notice(`Error al adjuntar ${files[i].name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.renderRight();
  }
}
