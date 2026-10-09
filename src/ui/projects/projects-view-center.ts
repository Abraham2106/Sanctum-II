import { Notice, setIcon } from "obsidian";
import type { Project, Thread } from "../../projects/types";
import { DEFAULT_MODEL } from "../../constants";
import { timeAgo } from "./projects-view-util";

export interface ProjectsCenterContext {
  centerEl: HTMLElement;
  activeProject: Project | null;
  threads: Thread[];
  memoryCount: number;
  getVectorCount: (id: string) => number;
  saveProject: (p: Project) => void;
  onOpenThread: (message: string, threadId?: string) => Promise<void>;
  onThreadMenu: (anchor: HTMLElement, thread: Thread) => void;
  setComposerInput: (el: HTMLTextAreaElement) => void;
}

export function renderProjectsCenter(ctx: ProjectsCenterContext): void {
  ctx.centerEl.empty();

  const p = ctx.activeProject;
  if (!p) {
    ctx.centerEl.createDiv({ cls: "s-proj-empty", text: "Seleccioná un proyecto" });
    return;
  }

  const bread = ctx.centerEl.createDiv({ cls: "s-proj-bread" });
  setIcon(bread.createSpan(), "arrow-left");
  bread.createSpan({ text: "Todos los proyectos" });

  const head = ctx.centerEl.createDiv({ cls: "s-proj-head" });
  head.createSpan({ text: `${p.icon} `, attr: { style: "font-size:28px" } });
  const nameDiv = head.createDiv({ attr: { style: "flex:1" } });
  const nameInput = nameDiv.createEl("input", {
    cls: "s-proj-head-input",
    attr: { value: p.name },
  });
  nameInput.onchange = () => {
    p.name = nameInput.value;
    ctx.saveProject(p);
  };
  if (p.description) nameDiv.createDiv({ cls: "s-proj-head-desc", text: p.description });

  const vc = ctx.getVectorCount(p.id);
  const stats = ctx.centerEl.createDiv({ cls: "s-proj-stats", attr: { "aria-label": "Resumen del proyecto" } });
  for (const [value, label] of [
    [vc, "chunks"],
    [p.read_paths?.length || 0, "carpetas"],
    [ctx.memoryCount, "memorias"],
  ] as Array<[number, string]>) {
    const stat = stats.createDiv({ cls: "s-proj-stat" });
    stat.createDiv({ cls: "s-proj-stat-value", text: String(value) });
    stat.createDiv({ cls: "s-proj-stat-label", text: label });
  }

  const comp = ctx.centerEl.createDiv({ cls: "s-proj-composer" });
  const compRow = comp.createDiv({ cls: "s-proj-composer-row" });
  const composerInput = compRow.createEl("textarea", {
    cls: "s-proj-composer-input",
    attr: { placeholder: "Continuar en el contexto de este proyecto…", rows: 1 },
  });
  ctx.setComposerInput(composerInput);
  const sendBtn = compRow.createEl("button", { cls: "s-proj-btn primary" });
  setIcon(sendBtn.createSpan(), "arrow-up");
  sendBtn.createSpan({ text: "Enviar" });
  sendBtn.onclick = () => {
    const text = composerInput.value.trim();
    if (!text) return;
    composerInput.value = "";
    void ctx.onOpenThread(text);
  };
  const compMeta = comp.createDiv({ cls: "s-proj-composer-meta" });
  setIcon(compMeta.createSpan(), "cpu");
  compMeta.createDiv({ cls: "s-proj-model-badge", text: p.model || DEFAULT_MODEL });

  ctx.centerEl.createDiv({ cls: "s-proj-section-title", text: "Conversaciones" });
  const threadListEl = ctx.centerEl.createDiv({ cls: "s-proj-threads" });
  for (const t of ctx.threads) {
    const row = threadListEl.createDiv({ cls: "s-proj-thread-row" });
    const info = row.createDiv({ cls: "s-proj-thread-info" });
    info.createSpan({ text: t.title, attr: { style: "font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block" } });
    const meta = info.createDiv({ cls: "s-proj-thread-meta" });
    meta.createSpan({ text: timeAgo(t.updated_at), attr: { style: "font-size:11px;color:var(--text-3)" } });
    if (t.starred) meta.createSpan({ text: "⭐", attr: { style: "font-size:10px" } });

    const menuBtn = row.createEl("button", { cls: "s-proj-thread-menu-btn", attr: { title: "Acciones" } });
    menuBtn.setText("⋮");
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      ctx.onThreadMenu(menuBtn, t);
    };
    row.onclick = async () => {
      await ctx.onOpenThread("", t.thread_id);
      new Notice("Conversación abierta");
    };
  }
  if (ctx.threads.length === 0) {
    const empty = threadListEl.createDiv({ cls: "s-proj-empty s-proj-thread-empty" });
    setIcon(empty.createSpan({ cls: "s-proj-empty-icon" }), "message-square-plus");
    empty.createDiv({ text: "Todavía no hay conversaciones", attr: { style: "font-weight:600;color:var(--text-2)" } });
    empty.createDiv({ text: "Escribí arriba para iniciar la primera dentro de este contexto." });
  }
}
