// DEC-0008: este trabajo vive aparte del archivo que lo mezcla

import { Notice, setIcon } from "obsidian";
import type { Thread } from "../../projects/types";
import { indexProject } from "../../projects/indexer";
import { ensureVaultDirectory } from "../../core/vault-fs";
import { InputModal } from "../input-modal";
import { FolderSelectModal } from "../folder-select-modal";
import type { ProjectsViewHost } from "../projects-view";

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60000) return "ahora";
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  return `${Math.floor(d / 86400000)}d`;
}

function cardTitle(parent: HTMLElement, lucide: string, text: string): HTMLElement {
  const d = parent.createDiv({ cls: "s-proj-card-title" });
  const ic = d.createSpan({ attr: { style: "display:inline-flex;vertical-align:middle;margin-right:4px" } });
  setIcon(ic, lucide);
  d.appendText(" " + text);
  return d;
}

export function renderCenterThreads(host: ProjectsViewHost): void {
  const p = host.activeProject;
  if (!p) return;

  host.centerEl.createDiv({ cls: "s-proj-section-title", text: "Conversaciones" });
  host.threadListEl = host.centerEl.createDiv({ cls: "s-proj-threads" });
  for (const t of host.threads) {
    const row = host.threadListEl.createDiv({ cls: "s-proj-thread-row" });
    const info = row.createDiv({ cls: "s-proj-thread-info" });
    info.createSpan({ text: t.title, attr: { style: "font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block" } });
    const meta = info.createDiv({ cls: "s-proj-thread-meta" });
    meta.createSpan({ text: timeAgo(t.updated_at), attr: { style: "font-size:11px;color:var(--text-3)" } });
    if (t.starred) meta.createSpan({ text: "⭐", attr: { style: "font-size:10px" } });

    const menuBtn = row.createEl("button", { cls: "s-proj-thread-menu-btn", attr: { title: "Acciones" } });
    menuBtn.setText("⋮");
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      showThreadMenu(host, menuBtn, t);
    };
    row.onclick = async () => {
      await host.deps.onOpenThread("", t.thread_id);
      new Notice("Conversación abierta");
    };
  }
  if (host.threads.length === 0) {
    const empty = host.threadListEl.createDiv({ cls: "s-proj-empty s-proj-thread-empty" });
    setIcon(empty.createSpan({ cls: "s-proj-empty-icon" }), "message-square-plus");
    empty.createDiv({ text: "Todavía no hay conversaciones", attr: { style: "font-weight:600;color:var(--text-2)" } });
    empty.createDiv({ text: "Escribí arriba para iniciar la primera dentro de este contexto." });
  }
}

export function renderRight(host: ProjectsViewHost): void {
  host.rightEl.empty();

  if (!host.activeProject) {
    host.rightEl.createDiv({ cls: "s-proj-empty", text: "Sin proyecto activo" });
    return;
  }
  const p = host.activeProject;

  const instCard = host.rightEl.createDiv({ cls: "s-proj-card" });
  cardTitle(instCard, "file-text", "Instrucciones");
  if (p.instructions) {
    instCard.createDiv({ cls: "s-config-group-text", text: p.instructions.slice(0, 200) + (p.instructions.length > 200 ? "…" : "") });
  } else {
    instCard.createDiv({ cls: "s-config-group-empty", text: "Sin instrucciones" });
  }

  const folderCard = host.rightEl.createDiv({ cls: "s-proj-card" });
  cardTitle(folderCard, "folder", "Carpetas con acceso");
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
      if (!host.activeProject) return;
      host.activeProject.read_paths = host.activeProject.read_paths.filter(x => x !== rp);
      host.activeProject.write_paths.push(rp);
      host.deps.saveProject(host.activeProject);
      host.renderRight();
    };
    const delBtn = row.createEl("button", { cls: "s-proj-row-action", attr: { title: "Quitar acceso de lectura", "aria-label": "Quitar acceso de lectura" } });
    setIcon(delBtn, "x");
    delBtn.style.opacity = "0";
    row.onmouseenter = () => { delBtn.style.opacity = "1"; };
    row.onmouseleave = () => { delBtn.style.opacity = "0"; };
    delBtn.onclick = () => {
      if (!host.activeProject) return;
      host.activeProject.read_paths = host.activeProject.read_paths.filter(x => x !== rp);
      host.deps.saveProject(host.activeProject);
      host.renderRight();
    };
  }
  for (const wp of p.write_paths) {
    const row = folderCard.createDiv({ cls: "s-proj-folder-row", attr: { style: "display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px" } });
    row.createSpan({ text: wp, attr: { style: "font-family:monospace;font-size:11px;flex:1" } });
    const badge = row.createSpan({ cls: "s-badge-internal orange", text: "escritura", attr: { style: "cursor:pointer" } });
    badge.title = "Clic para cambiar a lectura";
    badge.onclick = () => {
      if (!host.activeProject) return;
      host.activeProject.write_paths = host.activeProject.write_paths.filter(x => x !== wp);
      host.activeProject.read_paths.push(wp);
      host.deps.saveProject(host.activeProject);
      host.renderRight();
    };
    const delBtn = row.createEl("button", { cls: "s-proj-row-action", attr: { title: "Quitar acceso de escritura", "aria-label": "Quitar acceso de escritura" } });
    setIcon(delBtn, "x");
    delBtn.style.opacity = "0";
    row.onmouseenter = () => { delBtn.style.opacity = "1"; };
    row.onmouseleave = () => { delBtn.style.opacity = "0"; };
    delBtn.onclick = () => {
      if (!host.activeProject) return;
      host.activeProject.write_paths = host.activeProject.write_paths.filter(x => x !== wp);
      host.deps.saveProject(host.activeProject);
      host.renderRight();
    };
  }
  const addFolderBtn = folderCard.createEl("button", { cls: "s-proj-btn", text: "＋ Añadir carpeta" });
  addFolderBtn.onclick = () => addFolder(host);

  const ragCard = host.rightEl.createDiv({ cls: "s-proj-card" });
  cardTitle(ragCard, "database", "Índice RAG");
  const vc = host.deps.getVectorCount(p.id);
  for (const [label, value] of [
    ["Chunks", String(vc)],
    ["Embeddings", `${p.rag.embed_model} · ${p.rag.dims}d`],
    ["Recuperación", `top-${p.rag.top_k} · sim ≥ ${p.rag.min_similarity}`],
  ]) {
    const row = ragCard.createDiv({ cls: "s-proj-rag-row" });
    row.createSpan({ cls: "s-proj-rag-label", text: label });
    row.createSpan({ cls: "s-proj-rag-value", text: value });
  }
  const reindexBtn = ragCard.createEl("button", { cls: "s-proj-btn" });
  setIcon(reindexBtn.createSpan(), "refresh-cw");
  reindexBtn.createSpan({ text: "Reindexar proyecto" });
  reindexBtn.onclick = async () => {
    reindexBtn.setAttribute("disabled", "true");
    try { await reindex(host); } finally { reindexBtn.removeAttribute("disabled"); }
  };

  const memCard = host.rightEl.createDiv({ cls: "s-proj-card" });
  cardTitle(memCard, "brain", "Memoria persistente");
  if (host.memory.length) {
    for (const m of host.memory) {
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
  addMemBtn.onclick = () => addMemory(host);

  const fileCard = host.rightEl.createDiv({ cls: "s-proj-card" });
  const fileHeader = fileCard.createDiv({ cls: "s-config-group-title-row" });
  const fileIcon = fileHeader.createSpan({ attr: { style: "flex:1" } });
  const fSpan = fileIcon.createSpan({ attr: { style: "display:inline-flex;vertical-align:middle;margin-right:4px" } });
  setIcon(fSpan, "paperclip");
  fileIcon.appendText(" Archivos");
  const addFileBtn = fileHeader.createEl("button", { cls: "s-proj-file-add-btn", text: "+", attr: { title: "Adjuntar archivo" } });
  addFileBtn.onclick = () => addFile(host);

  const dropZone = fileCard.createDiv({ cls: "s-proj-dropzone" });
  setIcon(dropZone.createSpan({ cls: "s-proj-dropzone-icon" }), "upload-cloud");
  dropZone.createSpan({ text: "Soltá archivos aquí" });
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.addClass("active"); };
  dropZone.ondragleave = () => dropZone.removeClass("active");
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.removeClass("active");
    handleDrop(host, e);
  };

  const fileList = fileCard.createDiv({ cls: "s-proj-file-list" });
  const attached = host.activeProject?.attachedFiles || [];
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
        if (!host.activeProject || !await host.app.vault.adapter.exists(f.path).catch(() => false)) return;
        if (!confirm(`¿Quitar "${f.name}" del proyecto?`)) return;
        try { await host.app.vault.adapter.write(f.path, ""); } catch {}
        host.activeProject.attachedFiles = attached.filter(x => x.path !== f.path);
        host.activeProject.files = (host.activeProject.files || []).filter(fp => fp !== f.path);
        await host.deps.saveProject(host.activeProject);
        host.renderRight();
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

function showThreadMenu(host: ProjectsViewHost, anchor: HTMLElement, thread: Thread): void {
  host.closeMenu();
  const menu = document.body.createDiv({ cls: "s-thread-menu" });
  host.activeMenu = menu;

  const items: { label: string; shortcut?: string; cls?: string; action: () => void }[] = [
    {
      label: thread.starred ? "⭐ Quitar estrella" : "☆ Marcar con estrella", shortcut: "P",
      action: () => toggleStar(host, thread),
    },
    {
      label: "✏️ Renombrar", shortcut: "R",
      action: () => renameThread(host, thread),
    },
    {
      label: "📂 Cambiar proyecto", shortcut: "▸",
      action: () => showMoveMenu(host, menu, thread),
    },
    {
      label: "🗑 Eliminar del proyecto", shortcut: "D", cls: "destructive",
      action: () => deleteThread(host, thread),
    },
  ];

  for (const item of items) {
    const row = menu.createDiv({ cls: `s-thread-menu-item${item.cls ? " " + item.cls : ""}` });
    row.createSpan({ text: item.label, attr: { style: "flex:1" } });
    if (item.shortcut) row.createSpan({ text: item.shortcut, attr: { style: "font-size:10px;color:var(--text-3);margin-left:12px" } });
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

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "d" || e.key === "D") { items[3].action(); close(); }
    else if (e.key === "r" || e.key === "R") { items[1].action(); close(); }
    else if (e.key === "p" || e.key === "P") { items[0].action(); close(); }
  };
  document.addEventListener("keydown", keyHandler, { once: true });
}

async function toggleStar(host: ProjectsViewHost, thread: Thread): Promise<void> {
  if (!host.activeProject) return;
  const updated = await host.deps.projectStore.toggleStarThread(host.activeProject.id, thread.thread_id);
  if (updated) {
    thread.starred = updated.starred;
    host.renderCenter();
  }
}

async function renameThread(host: ProjectsViewHost, thread: Thread): Promise<void> {
  const modal = new InputModal(host.app, "Renombrar conversación", "Nuevo título", thread.title);
  const newTitle = await modal.ask();
  console.log(`[Proj] rename: old="${thread.title}" new="${newTitle}"`);
  if (!newTitle || !newTitle.trim() || !host.activeProject) {
    console.log(`[Proj] rename aborted`);
    return;
  }
  const tid = thread.thread_id;
  try {
    await host.deps.projectStore.renameThread(host.activeProject.id, tid, newTitle.trim());
    const idx = host.threads.findIndex(t => t.thread_id === tid);
    if (idx !== -1) host.threads[idx].title = newTitle.trim();
    console.log(`[Proj] rename OK -> ${newTitle.trim()}`);
    host.renderCenter();
  } catch (err: any) {
    console.error(`[Proj] rename error:`, err);
    new Notice("Error al renombrar: " + err.message);
  }
}

async function showMoveMenu(host: ProjectsViewHost, parentMenu: HTMLElement, thread: Thread): Promise<void> {
  const submenu = parentMenu.createDiv({ cls: "s-thread-submenu" });
  const ids = await host.deps.projectStore.listProjects();
  const otherProjects = ids.filter(id => id !== host.activeProject?.id);
  for (const pid of otherProjects) {
    let name = pid;
    try { const proj = await host.deps.projectStore.loadProject(pid); name = proj.name; } catch {}
    const row = submenu.createDiv({ cls: "s-thread-menu-item" });
    row.createSpan({ text: `→ ${name}`, attr: { style: "flex:1" } });
    row.onclick = async (e) => {
      e.stopPropagation();
      await host.deps.projectStore.moveThread(host.activeProject!.id, thread.thread_id, pid);
      new Notice(`Conversación movida a "${name}"`);
      host.closeMenu();
      await host.refresh();
    };
  }
  if (otherProjects.length === 0) {
    submenu.createDiv({ cls: "s-thread-menu-item", text: "No hay otros proyectos" });
  }
}

async function deleteThread(host: ProjectsViewHost, thread: Thread): Promise<void> {
  const confirmed = confirm(`¿Eliminar "${thread.title}"? Esta acción no se puede deshacer.`);
  if (!confirmed || !host.activeProject) return;
  await host.deps.projectStore.deleteThread(host.activeProject.id, thread.thread_id);
  host.threads = host.threads.filter(t => t.thread_id !== thread.thread_id);
  new Notice("Conversación eliminada");
  host.renderCenter();
}

function addFolder(host: ProjectsViewHost): void {
  if (!host.activeProject) return;
  new FolderSelectModal(host.app, (path) => {
    if (!host.activeProject) return;
    const clean = path.replace(/\\/g, "/");
    if (!host.activeProject.read_paths.includes(clean)) {
      host.activeProject.read_paths.push(clean);
    }
    host.deps.saveProject(host.activeProject);
    host.renderRight();
  }).open();
}

async function addMemory(host: ProjectsViewHost): Promise<void> {
  const modal = new InputModal(host.app, "Nueva memoria", "Hecho o decisión persistente");
  const text = await modal.ask();
  if (!text) return;
  await host.deps.appendMemory(text, "manual");
  await host.refresh();
}

async function reindex(host: ProjectsViewHost): Promise<void> {
  if (!host.activeProject) return;
  try {
    const { store } = host.deps.getVectorStore(host.activeProject.id);
    await indexProject(host.deps.vaultAdapter, host.deps.geminiBalancer, host.activeProject, store);
    new Notice(`Proyecto "${host.activeProject.name}" reindexado`);
    await host.refresh();
  } catch (err: any) {
    new Notice("Error al reindexar: " + err.message);
  }
}

function filesDir(host: ProjectsViewHost): string {
  return `sanctum-files/${host.activeProject?.id || "default"}`;
}

async function ingestFile(host: ProjectsViewHost, file: File): Promise<void> {
  if (!host.activeProject) return;
  const text = await file.text();
  const lines = text.split("\n").length;
  const ext = file.name.includes(".") ? file.name.split(".").pop() || "" : "";
  const vaultPath = `${filesDir(host)}/${file.name}`;

  const dir = filesDir(host);
  await ensureVaultDirectory(host.app.vault.adapter, dir);
  await host.app.vault.adapter.write(vaultPath, text);

  const attached = host.activeProject.attachedFiles || [];
  attached.push({
    path: vaultPath,
    name: file.name,
    ext,
    lines,
    added_at: Date.now(),
  });
  host.activeProject.attachedFiles = attached;

  if (!host.activeProject.files.includes(vaultPath)) {
    host.activeProject.files.push(vaultPath);
  }
  if (!host.activeProject.read_paths.includes(dir)) {
    host.activeProject.read_paths.push(dir);
  }

  await host.deps.saveProject(host.activeProject);
  new Notice(`📎 ${file.name} adjuntado (${lines} líneas)`);
}

function addFile(host: ProjectsViewHost): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = async () => {
    if (!host.activeProject) return;
    for (const file of Array.from(input.files || [])) {
      try {
        await ingestFile(host, file);
      } catch (err: any) {
        new Notice(`Error al adjuntar ${file.name}: ${err.message}`);
      }
    }
    host.renderRight();
  };
  input.click();
}

async function handleDrop(host: ProjectsViewHost, e: DragEvent): Promise<void> {
  const files = e.dataTransfer?.files;
  if (!files || !host.activeProject) return;
  for (let i = 0; i < files.length; i++) {
    try {
      await ingestFile(host, files[i]);
    } catch (err: any) {
      new Notice(`Error al adjuntar ${files[i].name}: ${err.message}`);
    }
  }
  host.renderRight();
}
