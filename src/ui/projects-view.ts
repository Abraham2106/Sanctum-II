import { ItemView, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { Project, Thread, MemoryEntry } from "../projects/types";
import { ProjectStore } from "../projects/store";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { VectorStore } from "../rag/vector-store";
import type { VaultAdapter } from "../core/vault-adapter";
import { renderLeft } from "./projects/list";
import { renderCenter } from "./projects/center";
import { renderCenterThreads, renderRight } from "./projects/detail";

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
}

export interface ProjectsViewHost {
  readonly app: App;
  readonly deps: ProjectsViewDeps;
  projects: Project[];
  activeProject: Project | null;
  threads: Thread[];
  memory: MemoryEntry[];
  leftEl: HTMLElement;
  centerEl: HTMLElement;
  rightEl: HTMLElement;
  threadListEl: HTMLElement;
  composerInput: HTMLTextAreaElement;
  activeMenu: HTMLElement | null;
  refresh(): Promise<void>;
  renderLeft(): void;
  renderCenter(): void;
  renderRight(): void;
  closeMenu(): void;
}

export class ProjectsView extends ItemView implements ProjectsViewHost {
  projects: Project[] = [];
  activeProject: Project | null = null;
  threads: Thread[] = [];
  memory: MemoryEntry[] = [];
  leftEl!: HTMLElement;
  centerEl!: HTMLElement;
  rightEl!: HTMLElement;
  threadListEl!: HTMLElement;
  composerInput!: HTMLTextAreaElement;
  activeMenu: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, readonly deps: ProjectsViewDeps) {
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

  renderLeft(): void {
    renderLeft(this);
  }

  renderCenter(): void {
    renderCenter(this);
    renderCenterThreads(this);
  }

  renderRight(): void {
    renderRight(this);
  }

  closeMenu(): void {
    if (this.activeMenu) { this.activeMenu.remove(); this.activeMenu = null; }
  }
}
