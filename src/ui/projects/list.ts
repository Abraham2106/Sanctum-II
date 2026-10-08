// DEC-0008: este trabajo vive aparte del archivo que lo mezcla

import { Notice, setIcon } from "obsidian";
import type { Project } from "../../projects/types";
import { InputModal } from "../input-modal";
import type { ProjectsViewHost } from "../projects-view";

export function renderLeft(host: ProjectsViewHost): void {
  host.leftEl.empty();

  const header = host.leftEl.createDiv({ cls: "s-proj-left-header" });
  const headerIcon = header.createSpan({ cls: "s-proj-header-icon" });
  setIcon(headerIcon, "folders");
  const headerCopy = header.createDiv();
  headerCopy.createDiv({ cls: "s-proj-header-title", text: "Proyectos" });
  headerCopy.createDiv({ cls: "s-proj-header-subtitle", text: `${host.projects.length} espacios de conocimiento` });

  const list = host.leftEl.createDiv({ cls: "s-proj-list" });

  const sorted = [...host.projects].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const p of sorted) {
    const row = list.createDiv({
      cls: "s-proj-row" + (p.id === host.deps.getActiveProjectId() ? " is-active" : ""),
    });
    row.createSpan({ text: (p.starred ? "⭐ " : p.icon + " ") });
    row.createSpan({ text: p.name, attr: { style: "font-weight:600" } });
    row.createSpan({ cls: "s-proj-badge", text: p.read_paths?.[0]?.replace("/", "") || "sin ruta" });

    const menuBtn = row.createEl("button", { cls: "s-proj-thread-menu-btn", attr: { title: "Acciones del proyecto" } });
    menuBtn.setText("⋮");
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      showProjectMenu(host, menuBtn, p);
    };

    row.onclick = async () => {
      await host.deps.onSelectProject(p.id);
      await host.refresh();
    };
  }

  const footer = host.leftEl.createDiv({ cls: "s-proj-left-footer" });
  const newBtn = footer.createEl("button", { cls: "s-proj-btn primary" });
  setIcon(newBtn.createSpan(), "plus");
  newBtn.createSpan({ text: "Nuevo proyecto" });
  newBtn.onclick = () => createProject(host);
}

export function showProjectMenu(host: ProjectsViewHost, anchor: HTMLElement, project: Project): void {
  host.closeMenu();
  const menu = document.body.createDiv({ cls: "s-thread-menu" });
  host.activeMenu = menu;

  const items: { label: string; cls?: string; action: () => void }[] = [
    {
      label: project.starred ? "⭐ Quitar estrella" : "☆ Marcar como favorito",
      action: () => toggleProjectStar(host, project),
    },
    {
      label: "✏️ Renombrar",
      action: () => renameProject(host, project),
    },
    {
      label: "🗑 Eliminar proyecto", cls: "destructive",
      action: () => deleteProject(host, project),
    },
  ];

  for (const item of items) {
    const row = menu.createDiv({ cls: `s-thread-menu-item${item.cls ? " " + item.cls : ""}` });
    row.createSpan({ text: item.label });
    row.onclick = (e) => { e.stopPropagation(); item.action(); host.closeMenu(); };
  }

  const rect = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.style.zIndex = "10000";

  const close = () => { host.closeMenu(); document.removeEventListener("click", close, true); document.removeEventListener("keydown", escHandler); };
  const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  setTimeout(() => document.addEventListener("click", close, true), 0);
  document.addEventListener("keydown", escHandler);
}

async function toggleProjectStar(host: ProjectsViewHost, project: Project): Promise<void> {
  project.starred = !project.starred;
  await host.deps.saveProject(project);
  new Notice(project.starred ? "⭐ Proyecto favorito" : "☆ Favorito quitado");
  host.renderLeft();
}

async function renameProject(host: ProjectsViewHost, project: Project): Promise<void> {
  const modal = new InputModal(host.app, "Renombrar proyecto", "Nuevo nombre", project.name);
  const newName = await modal.ask();
  if (!newName || !newName.trim()) return;
  project.name = newName.trim();
  await host.deps.saveProject(project);
  new Notice(`Proyecto renombrado a "${newName.trim()}"`);
  host.renderLeft();
}

async function deleteProject(host: ProjectsViewHost, project: Project): Promise<void> {
  const confirmed = confirm(`¿Eliminar el proyecto "${project.name}" y todos sus datos? Esta acción no se puede deshacer.`);
  if (!confirmed) return;
  try {
    await host.deps.projectStore.deleteProject(project.id);
    new Notice(`Proyecto "${project.name}" eliminado`);
    if (host.deps.getActiveProjectId() === project.id) {
      host.activeProject = null;
      host.threads = [];
      host.memory = [];
    }
    await host.refresh();
  } catch (err: any) {
    new Notice("Error al eliminar: " + err.message);
  }
}

async function createProject(host: ProjectsViewHost): Promise<void> {
  const modal = new InputModal(host.app, "Nuevo proyecto", "ID del proyecto (sin espacios)", "nuevo-proyecto");
  const parts = await modal.ask();
  if (!parts) return;
  const id = parts.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
  if (!id) { new Notice("ID inválido"); return; }
  const nameModal = new InputModal(host.app, "Nombre visible", "Nombre", id);
  const name = await nameModal.ask();
  await host.deps.projectStore.createProject(id, name || id);
  new Notice(`Proyecto "${name || id}" creado`);
  await host.refresh();
}
