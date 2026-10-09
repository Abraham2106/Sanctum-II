import type { Project } from "../../projects/types";
import { setIcon } from "obsidian";

export interface ProjectsLeftContext {
  leftEl: HTMLElement;
  projects: Project[];
  getActiveProjectId: () => string;
  onSelectProject: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onCreateProject: () => void;
  onProjectMenu: (anchor: HTMLElement, project: Project) => void;
}

export function renderProjectsLeft(ctx: ProjectsLeftContext): void {
  ctx.leftEl.empty();

  const header = ctx.leftEl.createDiv({ cls: "s-proj-left-header" });
  const headerIcon = header.createSpan({ cls: "s-proj-header-icon" });
  setIcon(headerIcon, "folders");
  const headerCopy = header.createDiv();
  headerCopy.createDiv({ cls: "s-proj-header-title", text: "Proyectos" });
  headerCopy.createDiv({ cls: "s-proj-header-subtitle", text: `${ctx.projects.length} espacios de conocimiento` });

  const list = ctx.leftEl.createDiv({ cls: "s-proj-list" });

  const sorted = [...ctx.projects].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const p of sorted) {
    const row = list.createDiv({
      cls: "s-proj-row" + (p.id === ctx.getActiveProjectId() ? " is-active" : ""),
    });
    row.createSpan({ text: (p.starred ? "⭐ " : p.icon + " ") });
    row.createSpan({ text: p.name, attr: { style: "font-weight:600" } });
    row.createSpan({ cls: "s-proj-badge", text: p.read_paths?.[0]?.replace("/", "") || "sin ruta" });

    const menuBtn = row.createEl("button", { cls: "s-proj-thread-menu-btn", attr: { title: "Acciones del proyecto" } });
    menuBtn.setText("⋮");
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      ctx.onProjectMenu(menuBtn, p);
    };

    row.onclick = async () => {
      await ctx.onSelectProject(p.id);
      await ctx.onRefresh();
    };
  }

  const footer = ctx.leftEl.createDiv({ cls: "s-proj-left-footer" });
  const newBtn = footer.createEl("button", { cls: "s-proj-btn primary" });
  setIcon(newBtn.createSpan(), "plus");
  newBtn.createSpan({ text: "Nuevo proyecto" });
  newBtn.onclick = () => ctx.onCreateProject();
}
