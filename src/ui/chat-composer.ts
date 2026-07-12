import { setIcon } from "obsidian";
import type { ChatViewPlugin, RailAgent } from "./chat-types";
import { getAgentIcon, renderAvatar } from "./chat-types";

export class ChatComposer {
  inputEl!: HTMLInputElement;
  sendBtn!: HTMLButtonElement;
  pipelineEl!: HTMLElement;
  modeChatBtn!: HTMLButtonElement;
  modeMeshBtn!: HTMLButtonElement;
  skillChipsEl!: HTMLElement;
  composerFolderSelect!: HTMLSelectElement;
  dropdownEl!: HTMLElement;

  private meshMode = false;
  private onToggleMesh: (() => void) | null = null;
  private onSend: (() => Promise<void>) | null = null;

  constructor(private plugin: ChatViewPlugin) {}

  private get app(): any { return (this.plugin as any).app; }

  build(parent: HTMLElement, opts: {
    onSend: () => Promise<void>;
    onToggleMesh: () => void;
  }): void {
    this.onSend = opts.onSend;
    this.onToggleMesh = opts.onToggleMesh;

    // § 5.1 Topbar
    const topbar = parent.createDiv({ cls: "s-topbar" });
    const breadcrumb = topbar.createDiv({ cls: "s-topbar-breadcrumb" });
    const icon = this.plugin.getActiveProjectIcon?.() || "◈";
    const name = this.plugin.getActiveProjectName?.() || "default";
    breadcrumb.innerHTML = `${icon} ${name} / <strong>Chat</strong>`;
    const actions = topbar.createDiv({ cls: "s-topbar-actions" });

    const makeIconBtn = (iconId: string, title: string, handler: () => void) => {
      const btn = actions.createEl("button", { cls: "s-icon-btn" });
      setIcon(btn, iconId);
      btn.title = title;
      btn.onclick = handler;
      return btn;
    };
    makeIconBtn("history", "Último trace", () => this.handleShowTrace());
    makeIconBtn("trash-2", "Limpiar chat", () => this.plugin["clearChatHistory"]?.());

    // Pipeline
    this.pipelineEl = parent.createDiv({ cls: "s-pipeline" });
    this.pipelineEl.style.display = "none";

    // Thread
    const threadWrapper = parent.createDiv({ cls: "s-thread" });
    const threadEl = threadWrapper.createDiv({ cls: "s-thread-inner" });

    // Composer
    this.buildComposer(parent);
  }

  private buildComposer(container: HTMLElement): void {
    const composer = container.createDiv({ cls: "s-composer" });
    const inner = composer.createDiv({ cls: "s-composer-inner" });

    const modeRow = inner.createDiv();
    const toggle = modeRow.createDiv({ cls: "s-mode-toggle" });

    this.modeChatBtn = toggle.createEl("button", { cls: "s-mode-btn active-chat" });
    const chatIcon = this.modeChatBtn.createSpan();
    setIcon(chatIcon, "message-square");
    this.modeChatBtn.createSpan({ text: " Chat" });

    this.modeMeshBtn = toggle.createEl("button", { cls: "s-mode-btn" });
    const meshIcon = this.modeMeshBtn.createSpan();
    setIcon(meshIcon, "shuffle");
    this.modeMeshBtn.createSpan({ text: " Mesh" });

    this.modeChatBtn.onclick = () => { if (this.meshMode) this.toggleMesh(); };
    this.modeMeshBtn.onclick = () => { if (!this.meshMode) this.toggleMesh(); };

    // Chain selector
    const chainBtn = toggle.createEl("button", { cls: "s-mode-btn" });
    setIcon(chainBtn, "link");
    chainBtn.title = "Ejecutar cadena";
    chainBtn.onclick = (e) => {
      e.stopPropagation();
      this.showChainMenu(chainBtn);
    };

    // Skill chips
    this.skillChipsEl = inner.createDiv({ cls: "s-skill-chips" });
    this.skillChipsEl.style.display = "none";

    // Input row
    const inputRow = inner.createDiv({ cls: "s-input-row" });
    this.inputEl = inputRow.createEl("input", { cls: "s-input" });
    this.inputEl.placeholder = "Pregunta para Agente Base...";
    this.sendBtn = inputRow.createEl("button", { cls: "s-send-btn chat-mode", text: "Enviar" });

    this.sendBtn.onclick = () => this.onSend?.();

    // Bottom bar
    const bar = inner.createDiv({ cls: "s-composer-bar" });

    this.composerFolderSelect = bar.createEl("select", { cls: "s-composer-chip-select" });
    this.composerFolderSelect.createEl("option", { text: "📂 Todo /Research/", value: "" });
    this.loadFolderList().then(() => {});
    this.composerFolderSelect.addEventListener("change", () => {
      this.plugin.setActiveFolder(this.composerFolderSelect.value || null);
    });

    const reindexChip = bar.createDiv({ cls: "s-composer-chip" });
    const reindexIcon = reindexChip.createSpan();
    setIcon(reindexIcon, "refresh-cw");
    reindexChip.createSpan({ text: " Reindexar" });
    reindexChip.onclick = () => this.plugin.indexResearch(this.plugin.activeFolder || undefined);

    const ragChip = bar.createDiv({ cls: "s-composer-chip" });
    const ragIcon = ragChip.createSpan();
    setIcon(ragIcon, "eye");
    ragChip.createSpan({ text: " Ver RAG" });
    ragChip.onclick = () => {
      this.plugin.runOrchestrate("¿Qué dice /Research/?");
    };

    // Autocomplete dropdown
    this.dropdownEl = composer.createDiv({ cls: "s-autocomplete" });
  }

  private async loadFolderList(): Promise<void> {
    try {
      const listing = await this.app.vault.adapter.list("Research");
      for (const folder of listing.folders) {
        const label = folder.replace(/^Research[\\/]?/, "");
        if (label) this.composerFolderSelect.createEl("option", { text: `📁 ${label}`, value: folder });
      }
      if (this.plugin.activeFolder) this.composerFolderSelect.value = this.plugin.activeFolder;
    } catch {}
  }

  set updateBreadcrumb(fn: () => string) {
    // The breadcrumb is updated via the host
  }

  private toggleMesh(): void {
    this.meshMode = !this.meshMode;
    this.modeChatBtn.classList.toggle("active-chat", !this.meshMode);
    this.modeMeshBtn.classList.toggle("active-mesh", this.meshMode);
    this.onToggleMesh?.();
  }

  private async handleShowTrace(): Promise<void> {
    try {
      const trace = await this.plugin.getLatestTrace();
      // Show trace via the host's messenger
    } catch {}
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.onSend?.();
    }
  }

  private async showChainMenu(anchor: HTMLElement): Promise<void> {
    const menu = document.body.createDiv({ cls: "s-thread-menu" });
    menu.style.position = "fixed";
    menu.style.zIndex = "10000";
    menu.createDiv({ text: "Cadenas guardadas", attr: { style: "font-size:11px;color:var(--text-3);padding:4px 10px" } });
    try {
      const listing = await this.app.vault.adapter.list("sanctum-chains");
      const files = listing.files.filter((f: string) => f.endsWith(".json"));
      if (files.length === 0) menu.createDiv({ text: "No hay cadenas. Creá una en el Orquestador.", attr: { style: "font-size:11px;color:var(--text-3);padding:6px 10px" } });
      for (const f of files) {
        const id = f.replace(/^.*[\\/]/, "").replace(".json", "");
        let name = id;
        try { const raw = await this.app.vault.adapter.read(f); const c = JSON.parse(raw); name = c.name || id; } catch {}
        const row = menu.createDiv({ cls: "s-thread-menu-item" });
        row.createSpan({ text: `⛓️ ${name}`, attr: { style: "flex:1" } });
        row.onclick = () => { this.inputEl.value = `@${id} ${this.inputEl.value}`; this.inputEl.focus(); menu.remove(); };
      }
    } catch {}
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    const close = () => { menu.remove(); document.removeEventListener("click", close, true); };
    setTimeout(() => document.addEventListener("click", close, true), 0);
  }

  showPipeline(active: boolean, step?: string, score?: number, attempts?: number): void {
    if (!active) { this.pipelineEl.style.display = "none"; return; }
    this.pipelineEl.style.display = "flex";
    this.pipelineEl.empty();

    const STEPS = [
      { id: "forager", label: "Forager", iconId: "search" },
      { id: "research", label: "Researcher", iconId: "book-open" },
      { id: "critic_review", label: "Critic", iconId: "scale" },
    ];
    const stepIndex = STEPS.findIndex(s => s.id === step);

    for (let i = 0; i < STEPS.length; i++) {
      let cls = "pending";
      if (i < stepIndex) cls = "done";
      else if (i === stepIndex) cls = "active";
      const pill = this.pipelineEl.createDiv({ cls: `s-pipeline-pill ${cls}` });
      const iconSpan = pill.createSpan();
      setIcon(iconSpan, STEPS[i].iconId);
      pill.createSpan({ text: ` ${STEPS[i].label}` });
      if (i === 1 && attempts && attempts > 1) pill.createSpan({ text: ` ×${attempts}`, attr: { style: "opacity:.7;font-size:10px" } });
      if (i < STEPS.length - 1) this.pipelineEl.createSpan({ cls: "s-pipeline-arrow", text: "→" });
    }
    if (step === "done") {
      if (score !== undefined) {
        const ring = this.pipelineEl.createDiv({ cls: `s-pipeline-score ${score >= 80 ? "ok" : "bad"}` });
        ring.setText(`${score}/100`);
      }
    }
  }

  setActiveSkill(name: string | null): void {
    this.skillChipsEl.empty();
    if (!name) {
      this.skillChipsEl.style.display = "none";
      return;
    }
    const chip = this.skillChipsEl.createDiv({ cls: "s-skill-chip" });
    chip.createSpan({ text: `/ ${name}` });
    const removeBtn = chip.createSpan({ cls: "s-skill-chip-remove" });
    removeBtn.textContent = "×";
    removeBtn.onclick = async () => {
      if (this.plugin.setSkillContext) await this.plugin.setSkillContext(null);
      this.setActiveSkill(null);
    };
    this.skillChipsEl.style.display = "";
  }

  getMeshMode(): boolean { return this.meshMode; }
  setMeshMode(v: boolean): void { this.meshMode = v; }
}
