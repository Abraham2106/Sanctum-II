import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type { Project, Thread, MemoryEntry, ProjectFile } from "../projects/types";
import { ProjectStore } from "../projects/store";
import { indexProject } from "../projects/indexer";
import { ensureVaultDirectory } from "../core/vault-fs";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { VectorStore } from "../rag/vector-store";
import type { VaultAdapter } from "../core/vault-adapter";
import { InputModal } from "./input-modal";
import { FolderSelectModal } from "./folder-select-modal";
import { DEFAULT_MODEL } from "../constants";

export const VIEW_TYPE_PROJECTS = "sanctum-projects";

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60000) return "ahora";
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  return `${Math.floor(d / 86400000)}d`;
}

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

export class ProjectsView extends ItemView {
  private projects: Project[] = [];
  private activeProject: Project | null = null;
  private threads: Thread[] = [];
  private memory: MemoryEntry[] = [];
  private leftEl!: HTMLElement;
  private centerEl!: HTMLElement;
  private rightEl!: HTMLElement;
  private threadListEl!: HTMLElement;
  private contextEl!: HTMLElement;
  private composerInput!: HTMLTextAreaElement;

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

  /** Inyecta datos ya cargados y renderiza de forma síncrona e inmediata. */
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

  // ── LEFT: Project list ──

  private renderLeft(): void {
    this.leftEl.empty();

    const header = this.leftEl.createDiv({ cls: "s-proj-left-header" });
    header.createSpan({ text: "◈ Proyectos", attr: { style: "font-weight:700;font-size:14px" } });

    const list = this.leftEl.createDiv({ cls: "s-proj-list" });

    // Sort: starred first, then alphabetically
    const sorted = [...this.projects].sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const p of sorted) {
      const row = list.createDiv({
        cls: "s-proj-row" + (p.id === this.deps.getActiveProjectId() ? " is-active" : ""),
      });
      row.createSpan({ text: (p.starred ? "⭐ " : p.icon + " ") });
      row.createSpan({ text: p.name, attr: { style: "font-weight:600" } });
      const badge = row.createSpan({ cls: "s-proj-badge", text: p.read_paths?.[0]?.replace("/", "") || "sin ruta" });

      // Three-dot menu button
      const menuBtn = row.createEl("button", { cls: "s-proj-thread-menu-btn", attr: { title: "Acciones del proyecto" } });
      menuBtn.setText("⋮");
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        this.showProjectMenu(menuBtn, p);
      };

      row.onclick = async () => {
        await this.deps.onSelectProject(p.id);
        await this.refresh();
      };
    }

    const footer = this.leftEl.createDiv({ cls: "s-proj-left-footer" });
    const newBtn = footer.createEl("button", { cls: "s-proj-btn primary", text: "＋ Nuevo" });
    newBtn.onclick = () => this.createProject();
  }

  // ── CENTER: Hub ──

  private renderCenter(): void {
    this.centerEl.empty();

    const p = this.activeProject;
    if (!p) {
      this.centerEl.createDiv({ cls: "s-proj-empty", text: "Seleccioná un proyecto" });
      return;
    }

    // Breadcrumb
    const bread = this.centerEl.createDiv({ cls: "s-proj-bread" });
    bread.createSpan({ text: "← Todos los proyectos", attr: { style: "cursor:pointer;color:var(--text-3)" } });

    // Header
    const head = this.centerEl.createDiv({ cls: "s-proj-head" });
    head.createSpan({ text: `${p.icon} `, attr: { style: "font-size:28px" } });
    const nameDiv = head.createDiv({ attr: { style: "flex:1" } });
    const nameInput = nameDiv.createEl("input", {
      cls: "s-proj-head-input",
      attr: { value: p.name },
    });
    nameInput.onchange = () => {
      p.name = nameInput.value;
      this.deps.saveProject(p);
    };
    if (p.description) nameDiv.createDiv({ cls: "s-proj-head-desc", text: p.description });

    // Context chip
    const chip = this.centerEl.createDiv({ cls: "s-proj-chip-bar" });
    const vc = this.deps.getVectorCount(p.id);
    chip.createSpan({ text: `📦 ${vc} chunks · ${p.read_paths?.length || 0} carpetas · ${this.memory.length} memorias` });

    // Composer — like chat: textarea + send button on same row
    const comp = this.centerEl.createDiv({ cls: "s-proj-composer" });
    const compRow = comp.createDiv({ cls: "s-proj-composer-row" });
    this.composerInput = compRow.createEl("textarea", {
      cls: "s-proj-composer-input",
      attr: { placeholder: "Continuar en el contexto de este proyecto…", rows: 1 },
    });
    const sendBtn = compRow.createEl("button", { cls: "s-proj-btn primary", text: "Enviar" });
    sendBtn.onclick = () => this.handleComposer();
    const modelBadge = comp.createDiv({ cls: "s-proj-model-badge",     text: p.model || DEFAULT_MODEL, attr: { style: "margin-top:8px" } });

    // Threads list
    this.centerEl.createDiv({ cls: "s-proj-section-title", text: "Conversaciones" });
    this.threadListEl = this.centerEl.createDiv({ cls: "s-proj-threads" });
    for (const t of this.threads) {
      const row = this.threadListEl.createDiv({ cls: "s-proj-thread-row" });
      const info = row.createDiv({ cls: "s-proj-thread-info" });
      info.createSpan({ text: t.title, attr: { style: "font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block" } });
      const meta = info.createDiv({ cls: "s-proj-thread-meta" });
      meta.createSpan({ text: timeAgo(t.updated_at), attr: { style: "font-size:11px;color:var(--text-3)" } });
      if (t.starred) meta.createSpan({ text: "⭐", attr: { style: "font-size:10px" } });

      // Three-dot menu (always reserve space for alignment)
      const menuBtn = row.createEl("button", { cls: "s-proj-thread-menu-btn", attr: { title: "Acciones" } });
      menuBtn.setText("⋮");
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        this.showThreadMenu(menuBtn, t);
      };
      row.onclick = async () => {
        await this.deps.onOpenThread("", t.thread_id);
        new Notice("Conversación abierta");
      };
    }
    if (this.threads.length === 0) {
      this.threadListEl.createDiv({ cls: "s-proj-empty", text: "Aún no hay conversaciones" });
    }
  }

  private async handleComposer(): Promise<void> {
    const text = this.composerInput.value.trim();
    if (!text) return;
    this.composerInput.value = "";
    await this.deps.onOpenThread(text);
  }

  // ── RIGHT: Context panel ──

  private cardTitle(parent: HTMLElement, lucide: string, text: string): HTMLElement {
    const d = parent.createDiv({ cls: "s-proj-card-title" });
    const ic = d.createSpan({ attr: { style: "display:inline-flex;vertical-align:middle;margin-right:4px" } });
    setIcon(ic, lucide);
    d.appendText(" " + text);
    return d;
  }

  private renderRight(): void {
    this.rightEl.empty();

    if (!this.activeProject) {
      this.rightEl.createDiv({ cls: "s-proj-empty", text: "Sin proyecto activo" });
      return;
    }
    const p = this.activeProject;

    // Instructions
    const instCard = this.rightEl.createDiv({ cls: "s-proj-card" });
    this.cardTitle(instCard, "file-text", "Instrucciones");
    if (p.instructions) {
      instCard.createDiv({ cls: "s-config-group-text", text: p.instructions.slice(0, 200) + (p.instructions.length > 200 ? "…" : "") });
    } else {
      instCard.createDiv({ cls: "s-config-group-empty", text: "Sin instrucciones" });
    }

    // Folders
    const folderCard = this.rightEl.createDiv({ cls: "s-proj-card" });
    this.cardTitle(folderCard, "folder", "Carpetas con acceso");
    const hasPaths = p.read_paths.length || p.write_paths.length;
    if (!hasPaths) {
      folderCard.createDiv({ cls: "s-config-group-empty", text: "Sin carpetas", attr: { style: "margin-bottom:6px" } });
    }
    // Show all read paths
    for (const rp of p.read_paths) {
      const row = folderCard.createDiv({ cls: "s-proj-folder-row", attr: { style: "display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px" } });
      row.createSpan({ text: rp, attr: { style: "font-family:monospace;font-size:11px;flex:1" } });
      const badge = row.createSpan({ cls: "s-badge-internal green", text: "lectura", attr: { style: "cursor:pointer" } });
      badge.title = "Clic para cambiar a escritura";
      badge.onclick = () => {
        if (!this.activeProject) return;
        this.activeProject.read_paths = this.activeProject.read_paths.filter(x => x !== rp);
        this.activeProject.write_paths.push(rp);
        this.deps.saveProject(this.activeProject);
        this.renderRight();
      };
      const delBtn = row.createEl("span", { text: "✕" });
      delBtn.style.cursor = "pointer"; delBtn.style.color = "var(--text-3)"; delBtn.style.fontSize = "10px"; delBtn.style.padding = "0 4px"; delBtn.style.opacity = "0"; delBtn.style.transition = "opacity .12s";
      row.onmouseenter = () => { delBtn.style.opacity = "1"; };
      row.onmouseleave = () => { delBtn.style.opacity = "0"; };
      delBtn.onclick = () => {
        if (!this.activeProject) return;
        this.activeProject.read_paths = this.activeProject.read_paths.filter(x => x !== rp);
        this.deps.saveProject(this.activeProject);
        this.renderRight();
      };
    }
    // Show all write paths
    for (const wp of p.write_paths) {
      const row = folderCard.createDiv({ cls: "s-proj-folder-row", attr: { style: "display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px" } });
      row.createSpan({ text: wp, attr: { style: "font-family:monospace;font-size:11px;flex:1" } });
      const badge = row.createSpan({ cls: "s-badge-internal orange", text: "escritura", attr: { style: "cursor:pointer" } });
      badge.title = "Clic para cambiar a lectura";
      badge.onclick = () => {
        if (!this.activeProject) return;
        this.activeProject.write_paths = this.activeProject.write_paths.filter(x => x !== wp);
        this.activeProject.read_paths.push(wp);
        this.deps.saveProject(this.activeProject);
        this.renderRight();
      };
      const delBtn = row.createEl("span", { text: "✕" });
      delBtn.style.cursor = "pointer"; delBtn.style.color = "var(--text-3)"; delBtn.style.fontSize = "10px"; delBtn.style.padding = "0 4px"; delBtn.style.opacity = "0"; delBtn.style.transition = "opacity .12s";
      row.onmouseenter = () => { delBtn.style.opacity = "1"; };
      row.onmouseleave = () => { delBtn.style.opacity = "0"; };
      delBtn.onclick = () => {
        if (!this.activeProject) return;
        this.activeProject.write_paths = this.activeProject.write_paths.filter(x => x !== wp);
        this.deps.saveProject(this.activeProject);
        this.renderRight();
      };
    }
    const addFolderBtn = folderCard.createEl("button", { cls: "s-proj-btn", text: "＋ Añadir carpeta" });
    addFolderBtn.onclick = () => this.addFolder();

    // RAG Index
    const ragCard = this.rightEl.createDiv({ cls: "s-proj-card" });
    ragCard.createDiv({ cls: "s-proj-card-title", text: "📊 Índice · RAG" });
    const vc = this.deps.getVectorCount(p.id);
    ragCard.createDiv({ cls: "s-trace-meta", text: `Chunks indexados: ${vc}` });
    ragCard.createDiv({ cls: "s-trace-meta", text: `Embeddings: ${p.rag.embed_model} (${p.rag.dims}d)` });
    ragCard.createDiv({ cls: "s-trace-meta", text: `Recuperación: top-${p.rag.top_k} / sim ≥ ${p.rag.min_similarity}` });
    const reindexBtn = ragCard.createEl("button", { cls: "s-proj-btn", text: "↻ Reindexar proyecto" });
    reindexBtn.onclick = async () => {
      reindexBtn.setAttribute("disabled", "true");
      try { await this.reindex(); } finally { reindexBtn.removeAttribute("disabled"); }
    };

    // Memory
    const memCard = this.rightEl.createDiv({ cls: "s-proj-card" });
    memCard.createDiv({ cls: "s-proj-card-title", text: "🧠 Memoria persistente" });
    if (this.memory.length) {
      for (const m of this.memory) {
        const memRow = memCard.createDiv({ cls: "s-proj-memory-row" });
        memRow.createSpan({ text: m.text, attr: { style: "font-size:12px" } });
        if (m.timestamp) {
          memRow.createSpan({ text: new Date(m.timestamp).toLocaleDateString(), attr: { style: "font-size:10px;color:var(--text-3)" } });
        }
      }
    } else {
      memCard.createDiv({ cls: "s-config-group-empty", text: "Aún no hay memoria; se irá llenando sola o agrégala manualmente" });
    }
    const addMemBtn = memCard.createEl("button", { cls: "s-proj-btn", text: "＋ Añadir memoria" });
    addMemBtn.onclick = () => this.addMemory();

    // Files
    const fileCard = this.rightEl.createDiv({ cls: "s-proj-card" });
    const fileHeader = fileCard.createDiv({ cls: "s-config-group-title-row" });
    const fileIcon = fileHeader.createSpan({ attr: { style: "flex:1" } });
    const fSpan = fileIcon.createSpan({ attr: { style: "display:inline-flex;vertical-align:middle;margin-right:4px" } });
    setIcon(fSpan, "paperclip");
    fileIcon.appendText(" Archivos");
    const addFileBtn = fileHeader.createEl("button", { cls: "s-proj-file-add-btn", text: "+", attr: { title: "Adjuntar archivo" } });
    addFileBtn.onclick = () => this.addFile();

    const dropZone = fileCard.createDiv({ cls: "s-proj-dropzone" });
    dropZone.createSpan({ text: "Soltá archivos aquí", attr: { style: "color:var(--text-3);font-size:11px" } });
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.addClass("active"); };
    dropZone.ondragleave = () => dropZone.removeClass("active");
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.removeClass("active");
      this.handleDrop(e);
    };

    const fileList = fileCard.createDiv({ cls: "s-proj-file-list" });
    const attached = this.activeProject?.attachedFiles || [];
    if (attached.length) {
      for (const f of attached) {
        const fRow = fileList.createDiv({ cls: "s-proj-row" });
        const fIcon = fRow.createDiv({ cls: "s-proj-file-icon" });
        fIcon.setText(f.ext.slice(0, 3).toUpperCase() || "📄");
        const fInfo = fRow.createDiv({ cls: "s-proj-info" });
        fInfo.createSpan({ text: f.name, attr: { style: "font-size:12px;color:var(--text-2)" } });
        fInfo.createDiv({ text: `${f.lines} líneas`, attr: { style: "font-size:10px;color:var(--text-3)" } });
        const delBtn = fRow.createEl("button", { cls: "s-proj-file-del-btn", text: "✕", attr: { title: "Quitar archivo" } });
        delBtn.onclick = async (ev) => {
          ev.stopPropagation();
          if (!this.activeProject || !await this.app.vault.adapter.exists(f.path).catch(() => false)) return;
          if (!confirm(`¿Quitar "${f.name}" del proyecto?`)) return;
          try { await this.app.vault.adapter.write(f.path, ""); } catch {}
          this.activeProject.attachedFiles = attached.filter(x => x.path !== f.path);
          this.activeProject.files = (this.activeProject.files || []).filter(fp => fp !== f.path);
          await this.deps.saveProject(this.activeProject);
          this.renderRight();
        };
      }
    } else {
      const empty = fileList.createDiv({ cls: "s-config-group-empty", text: "Sin archivos adjuntos" });
      empty.style.display = "none";
    }
    // Show dropzone only when no files
    if (attached.length === 0) dropZone.style.display = "block";
    else dropZone.style.display = "none";

    // Also keep legacy files display
    if (p.files?.length && !attached.length) {
      for (const f of p.files) fileList.createDiv({ cls: "s-trace-meta", text: f });
    }
  }

  // ── Thread menu ──

  private activeMenu: HTMLElement | null = null;

  private showThreadMenu(anchor: HTMLElement, thread: Thread): void {
    this.closeMenu();
    const menu = document.body.createDiv({ cls: "s-thread-menu" });
    this.activeMenu = menu;

    const items: { label: string; shortcut?: string; cls?: string; action: () => void }[] = [
      {
        label: thread.starred ? "⭐ Quitar estrella" : "☆ Marcar con estrella", shortcut: "P",
        action: () => this.toggleStar(thread),
      },
      {
        label: "✏️ Renombrar", shortcut: "R",
        action: () => this.renameThread(thread),
      },
      {
        label: "📂 Cambiar proyecto", shortcut: "▸",
        action: () => this.showMoveMenu(menu, thread),
      },
      {
        label: "🗑 Eliminar del proyecto", shortcut: "D", cls: "destructive",
        action: () => this.deleteThread(thread),
      },
    ];

    for (const item of items) {
      const row = menu.createDiv({ cls: `s-thread-menu-item${item.cls ? " " + item.cls : ""}` });
      row.createSpan({ text: item.label, attr: { style: "flex:1" } });
      if (item.shortcut) row.createSpan({ text: item.shortcut, attr: { style: "font-size:10px;color:var(--text-3);margin-left:12px" } });
      row.onclick = (e) => { e.stopPropagation(); item.action(); this.closeMenu(); };
    }

    const rect = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.style.zIndex = "10000";

    const close = () => { this.closeMenu(); document.removeEventListener("click", close, true); document.removeEventListener("keydown", escHandler); };
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    setTimeout(() => document.addEventListener("click", close, true), 0);
    document.addEventListener("keydown", escHandler);

    // Keyboard shortcuts
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D") { items[3].action(); close(); }
      else if (e.key === "r" || e.key === "R") { items[1].action(); close(); }
      else if (e.key === "p" || e.key === "P") { items[0].action(); close(); }
    };
    document.addEventListener("keydown", keyHandler, { once: true });
  }

  private closeMenu(): void {
    if (this.activeMenu) { this.activeMenu.remove(); this.activeMenu = null; }
  }

  private async toggleStar(thread: Thread): Promise<void> {
    if (!this.activeProject) return;
    const updated = await this.deps.projectStore.toggleStarThread(this.activeProject.id, thread.thread_id);
    if (updated) {
      thread.starred = updated.starred;
      this.renderCenter();
    }
  }

  private async renameThread(thread: Thread): Promise<void> {
    const modal = new InputModal(this.app, "Renombrar conversación", "Nuevo título", thread.title);
    const newTitle = await modal.ask();
    console.log(`[Proj] rename: old="${thread.title}" new="${newTitle}"`);
    if (!newTitle || !newTitle.trim() || !this.activeProject) {
      console.log(`[Proj] rename aborted`);
      return;
    }
    const tid = thread.thread_id;
    try {
      await this.deps.projectStore.renameThread(this.activeProject.id, tid, newTitle.trim());
      const idx = this.threads.findIndex(t => t.thread_id === tid);
      if (idx !== -1) this.threads[idx].title = newTitle.trim();
      console.log(`[Proj] rename OK -> ${newTitle.trim()}`);
      this.renderCenter();
    } catch (err: any) {
      console.error(`[Proj] rename error:`, err);
      new Notice("Error al renombrar: " + err.message);
    }
  }

  private async showMoveMenu(parentMenu: HTMLElement, thread: Thread): Promise<void> {
    const submenu = parentMenu.createDiv({ cls: "s-thread-submenu" });
    const ids = await this.deps.projectStore.listProjects();
    const otherProjects = ids.filter(id => id !== this.activeProject?.id);
    for (const pid of otherProjects) {
      let name = pid;
      try { const p = await this.deps.projectStore.loadProject(pid); name = p.name; } catch {}
      const row = submenu.createDiv({ cls: "s-thread-menu-item" });
      row.createSpan({ text: `→ ${name}`, attr: { style: "flex:1" } });
      row.onclick = async (e) => {
        e.stopPropagation();
        await this.deps.projectStore.moveThread(this.activeProject!.id, thread.thread_id, pid);
        new Notice(`Conversación movida a "${name}"`);
        this.closeMenu();
        await this.refresh();
      };
    }
    if (otherProjects.length === 0) {
      submenu.createDiv({ cls: "s-thread-menu-item", text: "No hay otros proyectos" });
    }
  }

  private async deleteThread(thread: Thread): Promise<void> {
    const confirmed = confirm(`¿Eliminar "${thread.title}"? Esta acción no se puede deshacer.`);
    if (!confirmed || !this.activeProject) return;
    await this.deps.projectStore.deleteThread(this.activeProject.id, thread.thread_id);
    this.threads = this.threads.filter(t => t.thread_id !== thread.thread_id);
    new Notice("Conversación eliminada");
    this.renderCenter();
  }

  // ── Project menu ──

  private showProjectMenu(anchor: HTMLElement, project: Project): void {
    this.closeMenu();
    const menu = document.body.createDiv({ cls: "s-thread-menu" });
    this.activeMenu = menu;

    const items: { label: string; cls?: string; action: () => void }[] = [
      {
        label: project.starred ? "⭐ Quitar estrella" : "☆ Marcar como favorito",
        action: () => this.toggleProjectStar(project),
      },
      {
        label: "✏️ Renombrar",
        action: () => this.renameProject(project),
      },
      {
        label: "🗑 Eliminar proyecto", cls: "destructive",
        action: () => this.deleteProject(project),
      },
    ];

    for (const item of items) {
      const row = menu.createDiv({ cls: `s-thread-menu-item${item.cls ? " " + item.cls : ""}` });
      row.createSpan({ text: item.label });
      row.onclick = (e) => { e.stopPropagation(); item.action(); this.closeMenu(); };
    }

    const rect = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.style.zIndex = "10000";

    const close = () => { this.closeMenu(); document.removeEventListener("click", close, true); document.removeEventListener("keydown", escHandler); };
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    setTimeout(() => document.addEventListener("click", close, true), 0);
    document.addEventListener("keydown", escHandler);
  }

  private async toggleProjectStar(project: Project): Promise<void> {
    project.starred = !project.starred;
    await this.deps.saveProject(project);
    new Notice(project.starred ? "⭐ Proyecto favorito" : "☆ Favorito quitado");
    this.renderLeft();
  }

  private async renameProject(project: Project): Promise<void> {
    const modal = new InputModal(this.app, "Renombrar proyecto", "Nuevo nombre", project.name);
    const newName = await modal.ask();
    if (!newName || !newName.trim()) return;
    project.name = newName.trim();
    await this.deps.saveProject(project);
    new Notice(`Proyecto renombrado a "${newName.trim()}"`);
    this.renderLeft();
  }

  private async deleteProject(project: Project): Promise<void> {
    const confirmed = confirm(`¿Eliminar el proyecto "${project.name}" y todos sus datos? Esta acción no se puede deshacer.`);
    if (!confirmed) return;
    try {
      await this.deps.projectStore.deleteProject(project.id);
      new Notice(`Proyecto "${project.name}" eliminado`);
      if (this.deps.getActiveProjectId() === project.id) {
        this.activeProject = null;
        this.threads = [];
        this.memory = [];
      }
      await this.refresh();
    } catch (err: any) {
      new Notice("Error al eliminar: " + err.message);
    }
  }

  // ── Actions ──

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
      this.deps.saveProject(this.activeProject);
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
    } catch (err: any) {
      new Notice("Error al reindexar: " + err.message);
    }
  }

  // ── File handling ──

  private filesDir(): string {
    return `sanctum-files/${this.activeProject?.id || "default"}`;
  }

  private async ingestFile(file: File): Promise<void> {
    if (!this.activeProject) return;
    const text = await file.text();
    const lines = text.split("\n").length;
    const ext = file.name.includes(".") ? file.name.split(".").pop() || "" : "";
    const vaultPath = `${this.filesDir()}/${file.name}`;

    const dir = this.filesDir();
    await ensureVaultDirectory(this.app.vault.adapter, dir);
    await this.app.vault.adapter.write(vaultPath, text);

    const attached = this.activeProject.attachedFiles || [];
    attached.push({
      path: vaultPath,
      name: file.name,
      ext,
      lines,
      added_at: Date.now(),
    });
    this.activeProject.attachedFiles = attached;

    if (!this.activeProject.files.includes(vaultPath)) {
      this.activeProject.files.push(vaultPath);
    }
    if (!this.activeProject.read_paths.includes(dir)) {
      this.activeProject.read_paths.push(dir);
    }

    await this.deps.saveProject(this.activeProject);
    new Notice(`📎 ${file.name} adjuntado (${lines} líneas)`);
  }

  private async addFile(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      if (!this.activeProject) return;
      for (const file of Array.from(input.files || [])) {
        try {
          await this.ingestFile(file);
        } catch (err: any) {
          new Notice(`Error al adjuntar ${file.name}: ${err.message}`);
        }
      }
      this.renderRight();
    };
    input.click();
  }

  private async handleDrop(e: DragEvent): Promise<void> {
    const files = e.dataTransfer?.files;
    if (!files || !this.activeProject) return;
    for (let i = 0; i < files.length; i++) {
      try {
        await this.ingestFile(files[i]);
      } catch (err: any) {
        new Notice(`Error al adjuntar ${files[i].name}: ${err.message}`);
      }
    }
    this.renderRight();
  }
}


