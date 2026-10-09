import { Notice } from "obsidian";
import type { App } from "obsidian";
import type { Project, Thread } from "../../projects/types";
import type { ProjectStore } from "../../projects/store";
import { InputModal } from "../input-modal";

export interface ProjectsMenuHost {
  app: App;
  projectStore: ProjectStore;
  getActiveProjectId: () => string;
  getActiveProject: () => Project | null;
  clearActiveProject: () => void;
  getThreads: () => Thread[];
  setThreads: (threads: Thread[]) => void;
  saveProject: (p: Project) => Promise<void>;
  onRefresh: () => Promise<void>;
  renderLeft: () => void;
  renderCenter: () => void;
  getActiveMenu: () => HTMLElement | null;
  setActiveMenu: (menu: HTMLElement | null) => void;
}

export function closeProjectsMenu(host: ProjectsMenuHost): void {
  const menu = host.getActiveMenu();
  if (menu) {
    menu.remove();
    host.setActiveMenu(null);
  }
}

export function showThreadMenu(host: ProjectsMenuHost, anchor: HTMLElement, thread: Thread): void {
  closeProjectsMenu(host);
  const menu = document.body.createDiv({ cls: "s-thread-menu" });
  host.setActiveMenu(menu);

  const items: { label: string; shortcut?: string; cls?: string; action: () => void }[] = [
    {
      label: thread.starred ? "⭐ Quitar estrella" : "☆ Marcar con estrella",
      shortcut: "P",
      action: () => void toggleStar(host, thread),
    },
    {
      label: "✏️ Renombrar",
      shortcut: "R",
      action: () => void renameThread(host, thread),
    },
    {
      label: "📂 Cambiar proyecto",
      shortcut: "▸",
      action: () => showMoveMenu(host, menu, thread),
    },
    {
      label: "🗑 Eliminar del proyecto",
      shortcut: "D",
      cls: "destructive",
      action: () => void deleteThread(host, thread),
    },
  ];

  for (const item of items) {
    const row = menu.createDiv({ cls: `s-thread-menu-item${item.cls ? " " + item.cls : ""}` });
    row.createSpan({ text: item.label, attr: { style: "flex:1" } });
    if (item.shortcut) row.createSpan({ text: item.shortcut, attr: { style: "font-size:10px;color:var(--text-3);margin-left:12px" } });
    row.onclick = (e) => {
      e.stopPropagation();
      item.action();
      closeProjectsMenu(host);
    };
  }

  const rect = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.style.zIndex = "10000";

  const close = () => {
    closeProjectsMenu(host);
    document.removeEventListener("click", close, true);
    document.removeEventListener("keydown", escHandler);
  };
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
  document.addEventListener("keydown", escHandler);

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "d" || e.key === "D") {
      items[3].action();
      close();
    } else if (e.key === "r" || e.key === "R") {
      items[1].action();
      close();
    } else if (e.key === "p" || e.key === "P") {
      items[0].action();
      close();
    }
  };
  document.addEventListener("keydown", keyHandler, { once: true });
}

async function toggleStar(host: ProjectsMenuHost, thread: Thread): Promise<void> {
  const activeProject = host.getActiveProject();
  if (!activeProject) return;
  const updated = await host.projectStore.toggleStarThread(activeProject.id, thread.thread_id);
  if (updated) {
    thread.starred = updated.starred;
    host.renderCenter();
  }
}

async function renameThread(host: ProjectsMenuHost, thread: Thread): Promise<void> {
  const modal = new InputModal(host.app, "Renombrar conversación", "Nuevo título", thread.title);
  const newTitle = await modal.ask();
  console.log(`[Proj] rename: old="${thread.title}" new="${newTitle}"`);
  if (!newTitle || !newTitle.trim() || !host.getActiveProject()) {
    console.log(`[Proj] rename aborted`);
    return;
  }
  const tid = thread.thread_id;
  const activeProject = host.getActiveProject()!;
  try {
    await host.projectStore.renameThread(activeProject.id, tid, newTitle.trim());
    const threads = host.getThreads();
    const idx = threads.findIndex((t) => t.thread_id === tid);
    if (idx !== -1) threads[idx].title = newTitle.trim();
    console.log(`[Proj] rename OK -> ${newTitle.trim()}`);
    host.renderCenter();
  } catch (err: unknown) {
    console.error(`[Proj] rename error:`, err);
    new Notice("Error al renombrar: " + (err instanceof Error ? err.message : String(err)));
  }
}

async function showMoveMenu(host: ProjectsMenuHost, parentMenu: HTMLElement, thread: Thread): Promise<void> {
  const submenu = parentMenu.createDiv({ cls: "s-thread-submenu" });
  const ids = await host.projectStore.listProjects();
  const activeProject = host.getActiveProject();
  const otherProjects = ids.filter((id) => id !== activeProject?.id);
  for (const pid of otherProjects) {
    let name = pid;
    try {
      const p = await host.projectStore.loadProject(pid);
      name = p.name;
    } catch {}
    const row = submenu.createDiv({ cls: "s-thread-menu-item" });
    row.createSpan({ text: `→ ${name}`, attr: { style: "flex:1" } });
    row.onclick = async (e) => {
      e.stopPropagation();
      await host.projectStore.moveThread(activeProject!.id, thread.thread_id, pid);
      new Notice(`Conversación movida a "${name}"`);
      closeProjectsMenu(host);
      await host.onRefresh();
    };
  }
  if (otherProjects.length === 0) {
    submenu.createDiv({ cls: "s-thread-menu-item", text: "No hay otros proyectos" });
  }
}

async function deleteThread(host: ProjectsMenuHost, thread: Thread): Promise<void> {
  const confirmed = confirm(`¿Eliminar "${thread.title}"? Esta acción no se puede deshacer.`);
  const activeProject = host.getActiveProject();
  if (!confirmed || !activeProject) return;
  await host.projectStore.deleteThread(activeProject.id, thread.thread_id);
  host.setThreads(host.getThreads().filter((t) => t.thread_id !== thread.thread_id));
  new Notice("Conversación eliminada");
  host.renderCenter();
}

export function showProjectMenu(host: ProjectsMenuHost, anchor: HTMLElement, project: Project): void {
  closeProjectsMenu(host);
  const menu = document.body.createDiv({ cls: "s-thread-menu" });
  host.setActiveMenu(menu);

  const items: { label: string; cls?: string; action: () => void }[] = [
    {
      label: project.starred ? "⭐ Quitar estrella" : "☆ Marcar como favorito",
      action: () => void toggleProjectStar(host, project),
    },
    {
      label: "✏️ Renombrar",
      action: () => void renameProject(host, project),
    },
    {
      label: "🗑 Eliminar proyecto",
      cls: "destructive",
      action: () => void deleteProject(host, project),
    },
  ];

  for (const item of items) {
    const row = menu.createDiv({ cls: `s-thread-menu-item${item.cls ? " " + item.cls : ""}` });
    row.createSpan({ text: item.label });
    row.onclick = (e) => {
      e.stopPropagation();
      item.action();
      closeProjectsMenu(host);
    };
  }

  const rect = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.style.zIndex = "10000";

  const close = () => {
    closeProjectsMenu(host);
    document.removeEventListener("click", close, true);
    document.removeEventListener("keydown", escHandler);
  };
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
  document.addEventListener("keydown", escHandler);
}

async function toggleProjectStar(host: ProjectsMenuHost, project: Project): Promise<void> {
  project.starred = !project.starred;
  await host.saveProject(project);
  new Notice(project.starred ? "⭐ Proyecto favorito" : "☆ Favorito quitado");
  host.renderLeft();
}

async function renameProject(host: ProjectsMenuHost, project: Project): Promise<void> {
  const modal = new InputModal(host.app, "Renombrar proyecto", "Nuevo nombre", project.name);
  const newName = await modal.ask();
  if (!newName || !newName.trim()) return;
  project.name = newName.trim();
  await host.saveProject(project);
  new Notice(`Proyecto renombrado a "${newName.trim()}"`);
  host.renderLeft();
}

async function deleteProject(host: ProjectsMenuHost, project: Project): Promise<void> {
  const confirmed = confirm(`¿Eliminar el proyecto "${project.name}" y todos sus datos? Esta acción no se puede deshacer.`);
  if (!confirmed) return;
  try {
    await host.projectStore.deleteProject(project.id);
    new Notice(`Proyecto "${project.name}" eliminado`);
    if (host.getActiveProjectId() === project.id) {
      host.clearActiveProject();
    }
    await host.onRefresh();
  } catch (err: unknown) {
    new Notice("Error al eliminar: " + (err instanceof Error ? err.message : String(err)));
  }
}
