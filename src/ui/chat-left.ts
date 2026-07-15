import { setIcon } from "obsidian";
import type { ChatViewPlugin, RailAgent } from "./chat-types";
import { renderAvatar } from "./chat-types";
import { DEFAULT_MODEL } from "../constants";

export class ChatLeftPanel {
  private el!: HTMLElement;
  private selectedAgent: RailAgent | null = null;

  constructor(private plugin: ChatViewPlugin) {}

  build(parent: HTMLElement, availableAgents: RailAgent[]): HTMLElement {
    this.el = parent;
    this.render(availableAgents);
    return this.el;
  }

  private render(availableAgents: RailAgent[]): void {
    this.el.empty();

    const header = this.el.createDiv({ cls: "s-left-header" });
    const logo = header.createDiv({ cls: "s-logo" });
    setIcon(logo, "sparkles");
    const logoText = header.createDiv({ cls: "s-logo-text" });
    logoText.createDiv({ cls: "s-logo-title", text: "Sanctum-II" });
    logoText.createDiv({ cls: "s-logo-sub", text: "Mesh de agentes" });

    const railSection = this.el.createDiv({ cls: "s-rail-section" });
    railSection.createDiv({ cls: "s-section-label", text: "Agentes" });

    const systemAgents: RailAgent[] = [
      { id: "forager", name: "Forager", avatar: "search", model: DEFAULT_MODEL },
      { id: "researcher", name: "Researcher", avatar: "book-open", model: DEFAULT_MODEL },
      { id: "critic", name: "Critic", avatar: "scale", model: DEFAULT_MODEL, internal: true },
    ];
    const customAgents = availableAgents.filter(a => !systemAgents.find(s => s.id === a.id));
    const allAgents = [...systemAgents, ...customAgents];

    if (!this.selectedAgent) this.selectedAgent = systemAgents[0];

    for (const agent of allAgents) {
      const item = railSection.createDiv({ cls: "s-rail-item" });
      if (agent.id === this.selectedAgent.id) item.addClass("is-active");

      const avatarSpan = item.createSpan({ cls: "s-rail-avatar" });
      renderAvatar(avatarSpan, agent.avatar, agent.id, setIcon);

      const info = item.createDiv({ cls: "s-rail-info" });
      info.createDiv({ cls: "s-rail-name", text: agent.name });
      info.createDiv({ cls: "s-rail-id", text: agent.id });
      if (agent.internal) item.createSpan({ cls: "s-badge-internal", text: "interno" });

      item.onclick = () => {
        this.el.querySelectorAll(".s-rail-item").forEach(el => el.removeClass("is-active"));
        item.addClass("is-active");
        this.selectedAgent = agent;
        this.renderConfig();
      };
    }

    this.el.createEl("hr", { attr: { style: "border:none;border-top:1px solid var(--border);margin:4px 10px;" } });

    const configScroll = this.el.createDiv({ cls: "s-config-scroll" });
    configScroll.id = "s-config-accordions";
    this.buildConfig(configScroll);

    const footer = this.el.createDiv({ cls: "s-left-footer" });
    const dot = footer.createDiv({ cls: "s-footer-dot" + (this.plugin.vectorStore.count === 0 ? " is-empty" : "") });
    const idxLabel = footer.createSpan();
    idxLabel.setText(this.plugin.vectorStore.count > 0 ? `${this.plugin.vectorStore.count} chunks` : "Sin indexar");
    const modelBadge = footer.createDiv({ cls: "s-footer-model" });
    modelBadge.setText(this.plugin.agent?.model || "deepseek");
  }

  private renderConfig(): void {
    const container = this.el.querySelector("#s-config-accordions") as HTMLElement;
    if (!container) return;
    container.empty();
    this.buildConfig(container);
  }

  private buildConfig(container: HTMLElement): void {
    const agent = this.selectedAgent;
    if (!agent) return;

    this.makeAccordion(container, "user", "Identidad", (body) => {
      this.makeField(body, "Nombre", agent.name);
      this.makeField(body, "Avatar", agent.avatar);
      const sel = this.makeSelectField(body, "Modelo", [DEFAULT_MODEL, "claude-sonnet-4-5", "claude-opus-4-5", "gemini-2.5-pro"]);
      sel.value = agent.model || DEFAULT_MODEL;
    });

    this.makeAccordion(container, "brain", "System Prompt", (body) => {
      const ta = body.createEl("textarea", { cls: "s-textarea" });
      ta.style.height = "120px";
      ta.value = this.plugin.agent?.system_prompt?.slice(0, 2000) || "(cargá el agente primero)";
    });

    this.makeAccordion(container, "database", "Contexto RAG", (body) => {
      const scopeField = body.createDiv({ cls: "s-field" });
      scopeField.createEl("label", { cls: "s-label", text: "Alcance del vault" });
      const sel = scopeField.createEl("select", { cls: "s-select" });
      sel.createEl("option", { text: "Todo /Research/", value: "" });
    });

    this.makeAccordion(container, "lock", "Permisos", (body) => {
      body.createEl("label", { cls: "s-label", text: "read_paths" });
      const readRow = body.createDiv({ cls: "s-chip-row" });
      (this.plugin.agent?.permissions?.read_paths || ["/Research/**"]).forEach(p => this.makeChip(readRow, p));
      body.createEl("label", { cls: "s-label", text: "write_paths", attr: { style: "margin-top:8px;display:block" } });
      const writeRow = body.createDiv({ cls: "s-chip-row" });
      const wp = this.plugin.agent?.permissions?.write_paths || [];
      if (wp.length === 0) writeRow.createSpan({ text: "—", attr: { style: "color:var(--text-3);font-size:12px" } });
      wp.forEach(p => this.makeChip(writeRow, p));
    });

    if (agent.id === "critic" || agent.internal) {
      this.makeAccordion(container, "scale", "Evaluación", (body) => {
        this.makeInputField(body, "Threshold", "80", "number");
        this.makeInputField(body, "Max intentos", "3", "number");
      });
    }

    this.makeAccordion(container, "folder", "Índice del vault", (body) => {
      const reindexBtn = body.createEl("button", {
        cls: "s-action-btn", text: "📚 Reindexar /Research/",
        attr: { style: "width:100%;padding:7px;font-size:12px;border-radius:var(--radius-sm);" }
      });
      reindexBtn.onclick = async () => {
        reindexBtn.textContent = "⏳ Indexando...";
        reindexBtn.setAttribute("disabled", "true");
        try {
          await this.plugin.indexResearch();
        } finally {
          reindexBtn.textContent = "📚 Reindexar /Research/";
          reindexBtn.removeAttribute("disabled");
          this.renderConfig();
        }
      };
    });
  }

  private makeAccordion(parent: HTMLElement, iconId: string, title: string, build: (body: HTMLElement) => void | Promise<void>): HTMLDetailsElement {
    const details = parent.createEl("details", { cls: "s-config-group" });
    const summary = details.createEl("summary");
    const iconSpan = summary.createSpan();
    setIcon(iconSpan, iconId);
    summary.createSpan({ text: ` ${title}` });
    const chevSpan = summary.createSpan({ cls: "s-chevron" });
    setIcon(chevSpan, "chevron-right");
    const body = details.createDiv({ cls: "s-config-body" });
    const result = build(body);
    if (result instanceof Promise) result.catch((err: any) => { if (err) console.warn("[LeftPanel] build:", err.message); });
    return details;
  }

  private makeField(parent: HTMLElement, label: string, value: string): HTMLElement {
    const f = parent.createDiv({ cls: "s-field" });
    f.createEl("label", { cls: "s-label", text: label });
    const span = f.createSpan({ text: value, attr: { style: "font-size:12.5px;color:var(--text-2)" } });
    return span;
  }

  private makeInputField(parent: HTMLElement, label: string, defaultVal: string, type = "text"): HTMLInputElement {
    const f = parent.createDiv({ cls: "s-field" });
    f.createEl("label", { cls: "s-label", text: label });
    const input = f.createEl("input", { cls: "s-input", attr: { type, value: defaultVal } });
    return input;
  }

  private makeSelectField(parent: HTMLElement, label: string, options: string[]): HTMLSelectElement {
    const f = parent.createDiv({ cls: "s-field" });
    f.createEl("label", { cls: "s-label", text: label });
    const sel = f.createEl("select", { cls: "s-select" });
    options.forEach(o => sel.createEl("option", { text: o }));
    return sel;
  }

  private makeChip(parent: HTMLElement, text: string): HTMLElement {
    const chip = parent.createDiv({ cls: "s-chip" });
    chip.createSpan({ text });
    return chip;
  }
}
