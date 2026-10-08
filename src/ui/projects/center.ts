// DEC-0008: este trabajo vive aparte del archivo que lo mezcla

import { setIcon } from "obsidian";
import { DEFAULT_MODEL } from "../../constants";
import type { ProjectsViewHost } from "../projects-view";

export function renderCenter(host: ProjectsViewHost): void {
  host.centerEl.empty();

  const p = host.activeProject;
  if (!p) {
    host.centerEl.createDiv({ cls: "s-proj-empty", text: "Seleccioná un proyecto" });
    return;
  }

  const bread = host.centerEl.createDiv({ cls: "s-proj-bread" });
  setIcon(bread.createSpan(), "arrow-left");
  bread.createSpan({ text: "Todos los proyectos" });

  const head = host.centerEl.createDiv({ cls: "s-proj-head" });
  head.createSpan({ text: `${p.icon} `, attr: { style: "font-size:28px" } });
  const nameDiv = head.createDiv({ attr: { style: "flex:1" } });
  const nameInput = nameDiv.createEl("input", {
    cls: "s-proj-head-input",
    attr: { value: p.name },
  });
  nameInput.onchange = () => {
    p.name = nameInput.value;
    host.deps.saveProject(p);
  };
  if (p.description) nameDiv.createDiv({ cls: "s-proj-head-desc", text: p.description });

  const vc = host.deps.getVectorCount(p.id);
  const stats = host.centerEl.createDiv({ cls: "s-proj-stats", attr: { "aria-label": "Resumen del proyecto" } });
  for (const [value, label] of [
    [vc, "chunks"],
    [p.read_paths?.length || 0, "carpetas"],
    [host.memory.length, "memorias"],
  ] as Array<[number, string]>) {
    const stat = stats.createDiv({ cls: "s-proj-stat" });
    stat.createDiv({ cls: "s-proj-stat-value", text: String(value) });
    stat.createDiv({ cls: "s-proj-stat-label", text: label });
  }

  const comp = host.centerEl.createDiv({ cls: "s-proj-composer" });
  const compRow = comp.createDiv({ cls: "s-proj-composer-row" });
  host.composerInput = compRow.createEl("textarea", {
    cls: "s-proj-composer-input",
    attr: { placeholder: "Continuar en el contexto de este proyecto…", rows: 1 },
  });
  const sendBtn = compRow.createEl("button", { cls: "s-proj-btn primary" });
  setIcon(sendBtn.createSpan(), "arrow-up");
  sendBtn.createSpan({ text: "Enviar" });
  sendBtn.onclick = () => handleComposer(host);
  const compMeta = comp.createDiv({ cls: "s-proj-composer-meta" });
  setIcon(compMeta.createSpan(), "cpu");
  compMeta.createDiv({ cls: "s-proj-model-badge", text: p.model || DEFAULT_MODEL });
}

export async function handleComposer(host: ProjectsViewHost): Promise<void> {
  const text = host.composerInput?.value.trim();
  if (!text) return;
  host.composerInput!.value = "";
  await host.deps.onOpenThread(text);
}
