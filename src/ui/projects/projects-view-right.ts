import { setIcon } from "obsidian";
import type { App } from "obsidian";
import type { Project, MemoryEntry } from "../../projects/types";
import type { IndexGenerationSnapshot } from "../../projects/index-generations";
import { detachAttachedFile } from "../../projects/detach-file";
import { classifyIndexUiState, indexUiStatusHint, indexUiStatusLabel } from "./index-state";
import { cardTitle } from "./projects-view-util";

export interface ProjectsRightContext {
  app: App;
  rightEl: HTMLElement;
  activeProject: Project | null;
  memory: MemoryEntry[];
  getVectorCount: (id: string) => number;
  getIndexSnapshot?: (projectId: string) => IndexGenerationSnapshot | null;
  saveProject: (p: Project) => void | Promise<void>;
  onAddFolder: () => void;
  onAddMemory: () => void;
  onReindex: () => Promise<void>;
  onAddFile: () => void;
  onDrop: (e: DragEvent) => void;
  onRenderRight: () => void;
  setActiveProject: (p: Project | null) => void;
}

export function renderProjectsRight(ctx: ProjectsRightContext): void {
  ctx.rightEl.empty();

  if (!ctx.activeProject) {
    ctx.rightEl.createDiv({ cls: "s-proj-empty", text: "Sin proyecto activo" });
    return;
  }
  const p = ctx.activeProject;

  const instCard = ctx.rightEl.createDiv({ cls: "s-proj-card" });
  cardTitle(instCard, "file-text", "Instrucciones", setIcon);
  if (p.instructions) {
    instCard.createDiv({ cls: "s-config-group-text", text: p.instructions.slice(0, 200) + (p.instructions.length > 200 ? "…" : "") });
  } else {
    instCard.createDiv({ cls: "s-config-group-empty", text: "Sin instrucciones" });
  }

  const folderCard = ctx.rightEl.createDiv({ cls: "s-proj-card" });
  cardTitle(folderCard, "folder", "Carpetas con acceso", setIcon);
  const hasPaths = p.read_paths.length || p.write_paths.length;
  if (!hasPaths) {
    folderCard.createDiv({ cls: "s-config-group-empty", text: "Sin carpetas", attr: { style: "margin-bottom:6px" } });
  }
  for (const rp of p.read_paths) {
    const row = folderCard.createDiv({ cls: "s-proj-folder-row", attr: { style: "display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px" } });
    row.createSpan({ text: rp, attr: { style: "font-family:monospace;font-size:11px;flex:1" } });
    const badge = row.createSpan({ cls: "s-badge-internal green", text: "lectura", attr: { style: "cursor:pointer" } });
    badge.title = "Clic para cambiar a escritura";
    badge.onclick = () => {
      if (!ctx.activeProject) return;
      ctx.activeProject.read_paths = ctx.activeProject.read_paths.filter((x) => x !== rp);
      ctx.activeProject.write_paths.push(rp);
      void ctx.saveProject(ctx.activeProject);
      ctx.onRenderRight();
    };
    const delBtn = row.createEl("button", { cls: "s-proj-row-action", attr: { title: "Quitar acceso de lectura", "aria-label": "Quitar acceso de lectura" } });
    setIcon(delBtn, "x");
    delBtn.style.opacity = "0";
    row.onmouseenter = () => {
      delBtn.style.opacity = "1";
    };
    row.onmouseleave = () => {
      delBtn.style.opacity = "0";
    };
    delBtn.onclick = () => {
      if (!ctx.activeProject) return;
      ctx.activeProject.read_paths = ctx.activeProject.read_paths.filter((x) => x !== rp);
      void ctx.saveProject(ctx.activeProject);
      ctx.onRenderRight();
    };
  }
  for (const wp of p.write_paths) {
    const row = folderCard.createDiv({ cls: "s-proj-folder-row", attr: { style: "display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px" } });
    row.createSpan({ text: wp, attr: { style: "font-family:monospace;font-size:11px;flex:1" } });
    const badge = row.createSpan({ cls: "s-badge-internal orange", text: "escritura", attr: { style: "cursor:pointer" } });
    badge.title = "Clic para cambiar a lectura";
    badge.onclick = () => {
      if (!ctx.activeProject) return;
      ctx.activeProject.write_paths = ctx.activeProject.write_paths.filter((x) => x !== wp);
      ctx.activeProject.read_paths.push(wp);
      void ctx.saveProject(ctx.activeProject);
      ctx.onRenderRight();
    };
    const delBtn = row.createEl("button", { cls: "s-proj-row-action", attr: { title: "Quitar acceso de escritura", "aria-label": "Quitar acceso de escritura" } });
    setIcon(delBtn, "x");
    delBtn.style.opacity = "0";
    row.onmouseenter = () => {
      delBtn.style.opacity = "1";
    };
    row.onmouseleave = () => {
      delBtn.style.opacity = "0";
    };
    delBtn.onclick = () => {
      if (!ctx.activeProject) return;
      ctx.activeProject.write_paths = ctx.activeProject.write_paths.filter((x) => x !== wp);
      void ctx.saveProject(ctx.activeProject);
      ctx.onRenderRight();
    };
  }
  const addFolderBtn = folderCard.createEl("button", { cls: "s-proj-btn", text: "＋ Añadir carpeta" });
  addFolderBtn.onclick = () => ctx.onAddFolder();

  const ragCard = ctx.rightEl.createDiv({ cls: "s-proj-card" });
  cardTitle(ragCard, "database", "Índice RAG", setIcon);
  const vc = ctx.getVectorCount(p.id);
  const indexSnap = ctx.getIndexSnapshot?.(p.id) ?? null;
  const indexUi = classifyIndexUiState(indexSnap);
  const indexRow = ragCard.createDiv({ cls: "s-proj-rag-row" });
  indexRow.createSpan({ cls: "s-proj-rag-label", text: "Estado" });
  indexRow.createSpan({ cls: "s-proj-rag-value", text: indexUiStatusLabel(indexUi) });
  const indexHint = indexUiStatusHint(indexUi);
  if (indexHint) {
    ragCard.createDiv({ cls: "s-config-group-empty", text: indexHint, attr: { style: "margin-bottom:6px" } });
  }
  for (const [label, value] of [
    ["Chunks", String(vc)],
    ["Embeddings", `${p.embedding?.model || p.rag.embed_model} · ${p.embedding?.dims || p.rag.dims}d`],
    ["Recuperación", `top-${p.rag.top_k} · sim ≥ ${p.rag.min_similarity}`],
  ]) {
    const row = ragCard.createDiv({ cls: "s-proj-rag-row" });
    row.createSpan({ cls: "s-proj-rag-label", text: label });
    row.createSpan({ cls: "s-proj-rag-value", text: value });
  }

  const embedOverride = ragCard.createDiv({ cls: "s-proj-rag-row" });
  embedOverride.createSpan({ cls: "s-proj-rag-label", text: "Proveedor (proyecto)" });
  const embedSelect = embedOverride.createEl("select", { cls: "s-composer-chip-select" });
  embedSelect.createEl("option", { text: "Heredar global", value: "" });
  embedSelect.createEl("option", { text: "Gemini", value: "gemini" });
  embedSelect.createEl("option", { text: "Local (sentence-transformers)", value: "sentence-transformers" });
  if (p.embedding?.backend) embedSelect.value = p.embedding.backend;
  embedSelect.onchange = () => {
    const backend = embedSelect.value as "" | "gemini" | "sentence-transformers";
    if (!backend) {
      delete p.embedding;
    } else {
      p.embedding = {
        backend,
        model: backend === "gemini" ? p.rag.embed_model : "google/embeddinggemma-2",
        revision: backend === "gemini" ? "api" : p.embedding?.revision || "",
        dims: p.embedding?.dims || p.rag.dims,
      };
    }
    void ctx.saveProject(p);
  };
  const reindexBtn = ragCard.createEl("button", { cls: "s-proj-btn" });
  setIcon(reindexBtn.createSpan(), "refresh-cw");
  reindexBtn.createSpan({ text: "Reindexar proyecto" });
  reindexBtn.onclick = async () => {
    reindexBtn.setAttribute("disabled", "true");
    try {
      await ctx.onReindex();
    } finally {
      reindexBtn.removeAttribute("disabled");
    }
  };

  const memCard = ctx.rightEl.createDiv({ cls: "s-proj-card" });
  cardTitle(memCard, "brain", "Memoria persistente", setIcon);
  if (ctx.memory.length) {
    for (const m of ctx.memory) {
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
  addMemBtn.onclick = () => ctx.onAddMemory();

  const fileCard = ctx.rightEl.createDiv({ cls: "s-proj-card" });
  const fileHeader = fileCard.createDiv({ cls: "s-config-group-title-row" });
  const fileIcon = fileHeader.createSpan({ attr: { style: "flex:1" } });
  const fSpan = fileIcon.createSpan({ attr: { style: "display:inline-flex;vertical-align:middle;margin-right:4px" } });
  setIcon(fSpan, "paperclip");
  fileIcon.appendText(" Archivos");
  const addFileBtn = fileHeader.createEl("button", { cls: "s-proj-file-add-btn", text: "+", attr: { title: "Adjuntar archivo" } });
  addFileBtn.onclick = () => ctx.onAddFile();

  const dropZone = fileCard.createDiv({ cls: "s-proj-dropzone" });
  setIcon(dropZone.createSpan({ cls: "s-proj-dropzone-icon" }), "upload-cloud");
  dropZone.createSpan({ text: "Soltá archivos aquí" });
  dropZone.ondragover = (e) => {
    e.preventDefault();
    dropZone.addClass("active");
  };
  dropZone.ondragleave = () => dropZone.removeClass("active");
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.removeClass("active");
    void ctx.onDrop(e);
  };

  const fileList = fileCard.createDiv({ cls: "s-proj-file-list" });
  const attached = ctx.activeProject?.attachedFiles || [];
  if (attached.length) {
    for (const f of attached) {
      const fRow = fileList.createDiv({ cls: "s-proj-row" });
      const fIcon = fRow.createDiv({ cls: "s-proj-file-icon" });
      fIcon.setText(f.ext.slice(0, 3).toUpperCase() || "DOC");
      const fInfo = fRow.createDiv({ cls: "s-proj-info" });
      fInfo.createSpan({ text: f.name, attr: { style: "font-size:12px;color:var(--text-2)" } });
      fInfo.createDiv({ text: `${f.lines} líneas`, attr: { style: "font-size:10px;color:var(--text-3)" } });
      const delBtn = fRow.createEl("button", { cls: "s-proj-file-del-btn", text: "✕", attr: { title: "Quitar archivo" } });
      delBtn.onclick = async (ev) => {
        ev.stopPropagation();
        if (!confirm(`¿Quitar "${f.name}" del proyecto?`)) return;
        if (!ctx.activeProject) return;
        const updated = detachAttachedFile(ctx.activeProject, f.path);
        ctx.setActiveProject(updated);
        await ctx.saveProject(updated);
        ctx.onRenderRight();
      };
    }
  } else {
    fileList.createDiv({ cls: "s-config-group-empty", text: "Sin archivos adjuntos" });
  }
  if (attached.length === 0) dropZone.style.display = "block";
  else dropZone.style.display = "none";

  if (p.files?.length && !attached.length) {
    for (const f of p.files) fileList.createDiv({ cls: "s-trace-meta", text: f });
  }
}
