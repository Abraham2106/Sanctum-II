import { App, getIconIds, Modal, Notice, setIcon } from "obsidian";
import { AgentAuthoringService } from "../agents/authoring/service";
import { SUPPORTED_AGENT_TOOLS, type AgentGenerationRequest, type AgentGenerationResult, type AgentTool } from "../agents/authoring/types";

const TOOL_LABELS: Record<AgentTool, string> = {
  rag_query: "Consultar índice RAG",
  web_search: "Buscar en la web",
  create_note: "Crear notas",
  append_to_note: "Actualizar notas",
};

const FEATURED_AGENT_ICONS = [
  "bot", "sparkles", "brain", "search", "book-open", "scale", "globe", "shield-check",
  "briefcase-business", "file-search", "microscope", "code-xml", "database", "chart-no-axes-combined",
  "pen-tool", "messages-square", "workflow", "wand-sparkles", "lightbulb", "circle-check-big",
];

function getLucideIconLibrary(): string[] {
  const available = [...new Set(getIconIds().map(icon => String(icon).replace(/^lucide-/, "")))]
    .filter(icon => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon));
  const availableSet = new Set(available);
  const featured = FEATURED_AGENT_ICONS.filter(icon => availableSet.has(icon));
  return [...featured, ...available.filter(icon => !featured.includes(icon)).sort()];
}

function parsePaths(value: string): string[] {
  return value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
}

export class AgentGeneratorModal extends Modal {
  private readonly service: AgentAuthoringService;
  private resolve!: (value: AgentGenerationResult | null) => void;
  private initialDescription: string;
  private result: AgentGenerationResult | null = null;
  private lastRequest: AgentGenerationRequest | null = null;

  constructor(app: App, service: AgentAuthoringService, initialDescription = "") {
    super(app);
    this.service = service;
    this.initialDescription = initialDescription;
    this.contentEl.style.maxWidth = "720px";
    this.modalEl.addClass("s-agent-authoring-modal");
  }

  async ask(): Promise<AgentGenerationResult | null> {
    return new Promise(resolve => { this.resolve = resolve; this.open(); });
  }

  onOpen(): void { this.renderForm(); }

  private renderForm(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({ text: "Crear agente", attr: { style: "font-size:18px;font-weight:700;margin-bottom:4px" } });
    contentEl.createDiv({ text: "Escribí un brief del agente. La IA lo convertirá en un prompt operativo y el módulo validará sus permisos.", attr: { style: "font-size:12px;color:var(--text-3);margin-bottom:18px" } });

    const previous = this.lastRequest;
    const description = this.field(contentEl, "Descripción del agente para la IA", "Ej: Revisa contratos, identifica cláusulas de riesgo, explica el impacto y cita la fuente. Si faltan datos, debe indicarlo.", previous?.description ?? this.initialDescription, "textarea");
    (description as HTMLTextAreaElement).rows = 4;
    contentEl.createDiv({
      text: "Incluí objetivo, fuentes que debe usar, límites y cómo esperás que responda. Esta descripción se envía al LLM para redactar el prompt del agente.",
      cls: "s-agent-field-help",
    });
    const name = this.field(contentEl, "Nombre visible", "Ej: Revisor Legal", previous?.name ?? "");
    const id = this.field(contentEl, "ID (opcional)", "revisor-legal", previous?.id ?? "");
    const avatar = this.iconPicker(contentEl, previous?.avatar ?? "bot");

    const access = contentEl.createDiv({ attr: { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px" } });
    const readPaths = this.field(access, "Rutas de lectura", "Ej: /Research/** (obligatorio para RAG)", previous?.readPaths?.join("\n") ?? "", "textarea");
    const writePaths = this.field(access, "Rutas de escritura", "Dejar vacío para solo lectura", previous?.writePaths?.join("\n") ?? "", "textarea");
    (readPaths as HTMLTextAreaElement).rows = 2;
    (writePaths as HTMLTextAreaElement).rows = 2;

    const flags = contentEl.createDiv({ attr: { style: "display:flex;gap:16px;flex-wrap:wrap;margin:14px 0" } });
    const internal = this.checkbox(flags, "Agente interno del Mesh", previous?.internal ?? false);
    const mention = this.checkbox(flags, "Permitir @mención", previous?.mention ?? true);
    const includeSkill = this.checkbox(flags, "Crear skill complementaria", previous?.includeSkill ?? false);

    contentEl.createDiv({ text: "Tools", attr: { style: "font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px" } });
    const toolsWrap = contentEl.createDiv({ attr: { style: "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px" } });
    const toolInputs = new Map<AgentTool, HTMLInputElement>();
    for (const tool of SUPPORTED_AGENT_TOOLS) {
      const input = this.checkbox(toolsWrap, TOOL_LABELS[tool], previous?.tools?.includes(tool) ?? false);
      toolInputs.set(tool, input);
    }
    const toolHint = contentEl.createDiv({ cls: "s-agent-tool-hint" });
    const syncToolPermissions = () => {
      const hasReadPath = parsePaths(readPaths.value).length > 0;
      const hasWritePath = parsePaths(writePaths.value).length > 0;
      const rag = toolInputs.get("rag_query");
      if (rag) {
        rag.disabled = !hasReadPath;
        if (!hasReadPath) rag.checked = false;
      }
      for (const tool of ["create_note", "append_to_note"] as AgentTool[]) {
        const input = toolInputs.get(tool);
        if (!input) continue;
        input.disabled = !hasWritePath;
        if (!hasWritePath) input.checked = false;
      }
      toolHint.setText(!hasReadPath && !hasWritePath
        ? "Definí rutas para habilitar RAG o escritura. La búsqueda web no necesita acceso al vault."
        : !hasWritePath
          ? "El agente queda en modo solo lectura; agregá una ruta de escritura para crear o actualizar notas."
          : "Las herramientas solo operarán dentro de las rutas declaradas.");
    };
    readPaths.addEventListener("input", syncToolPermissions);
    writePaths.addEventListener("input", syncToolPermissions);
    syncToolPermissions();

    const buttons = contentEl.createDiv({ attr: { style: "display:flex;justify-content:flex-end;gap:8px" } });
    const cancel = buttons.createEl("button", { text: "Cancelar" });
    cancel.onclick = () => this.finish(null);
    const generate = buttons.createEl("button", { text: "Generar borrador" });
    generate.addClass("mod-cta");
    generate.onclick = async () => {
      generate.disabled = true;
      generate.setText("Generando…");
      try {
        const request: AgentGenerationRequest = {
          description: description.value.trim(),
          name: name.value.trim() || undefined,
          id: id.value.trim() || undefined,
          avatar: avatar.value,
          internal: internal.checked,
          mention: mention.checked,
          readPaths: parsePaths(readPaths.value),
          writePaths: parsePaths(writePaths.value),
          tools: SUPPORTED_AGENT_TOOLS.filter(tool => toolInputs.get(tool)?.checked) as AgentTool[],
          includeSkill: includeSkill.checked,
        };
        this.lastRequest = request;
        this.result = await this.service.generate(request);
        this.renderReview();
      } catch (error: any) {
        new Notice(error?.message || "No se pudo generar el agente");
        generate.disabled = false;
        generate.setText("Generar borrador");
      }
    };
  }

  private renderReview(): void {
    if (!this.result) return;
    const { contentEl } = this;
    contentEl.empty();
    const reviewHeader = contentEl.createDiv({ cls: "s-agent-review-header" });
    const reviewAvatar = reviewHeader.createDiv({ cls: "s-agent-review-avatar" });
    setIcon(reviewAvatar, this.result.agent.avatar || "bot");
    const reviewTitle = reviewHeader.createDiv();
    reviewTitle.createDiv({ text: "Revisar definición", cls: "s-agent-review-title" });
    reviewTitle.createDiv({ text: `${this.result.agent.name} · @${this.result.agent.id}`, cls: "s-agent-review-meta" });

    const errors = this.result.issues.filter(issue => issue.severity === "error");
    const warnings = this.result.issues.filter(issue => issue.severity === "warning");
    const diagnostics = contentEl.createDiv({ attr: { style: "display:flex;flex-direction:column;gap:5px;margin-bottom:12px" } });
    for (const issue of this.result.issues) {
      const row = diagnostics.createDiv({ text: `${issue.severity === "error" ? "Error" : "Aviso"} · ${issue.message}`, attr: { style: `font-size:12px;padding:7px 9px;border-radius:6px;background:${issue.severity === "error" ? "var(--red-soft)" : "var(--orange-soft)"};color:${issue.severity === "error" ? "var(--red)" : "var(--orange)"}` } });
      row.dataset.field = issue.field;
    }
    if (!this.result.issues.length) diagnostics.createDiv({ text: "Lista para guardar", cls: "s-agent-valid-state" });
    for (const assumption of this.result.assumptions) contentEl.createDiv({ text: `Ajuste automático · ${assumption}`, cls: "s-agent-assumption" });

    const promptPanel = contentEl.createDiv({ cls: "s-agent-prompt-panel" });
    promptPanel.createDiv({ text: "Prompt operativo generado", cls: "s-agent-prompt-title" });
    promptPanel.createDiv({ text: "Este es el prompt creado por la IA a partir de tu descripción. {{user_prompt}} se reemplazará con cada mensaje dirigido al agente.", cls: "s-agent-prompt-help" });
    const promptPreview = promptPanel.createEl("textarea", { cls: "s-agent-prompt-preview", attr: { readonly: "true", "aria-label": "Prompt operativo generado" } });
    promptPreview.value = this.result.agent.systemPrompt;

    const definition = contentEl.createEl("details", { cls: "s-agent-definition-details" });
    definition.createEl("summary", { text: "Ver definición Markdown completa" });
    const preview = definition.createEl("textarea", { attr: { readonly: "true", style: "width:100%;min-height:240px;resize:vertical;font-family:var(--font-mono);font-size:11px;background:var(--surface);color:var(--text-2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px" } });
    preview.value = this.result.agentMarkdown + (this.result.skillMarkdown ? `\n--- Skill complementaria ---\n${this.result.skillMarkdown}` : "");

    const buttons = contentEl.createDiv({ attr: { style: "display:flex;justify-content:space-between;gap:8px;margin-top:12px" } });
    const back = buttons.createEl("button", { text: "Editar" });
    back.onclick = () => this.renderForm();
    const save = buttons.createEl("button", { text: errors.length ? "Corregir errores" : "Confirmar y guardar" });
    save.addClass("mod-cta");
    save.disabled = errors.length > 0;
    save.onclick = () => {
      if (this.result && !errors.length) this.finish(this.result);
      else if (warnings.length) this.finish(this.result);
    };
  }

  private field(parent: HTMLElement, label: string, placeholder: string, value: string, type: "input" | "textarea" = "input"): HTMLInputElement & HTMLTextAreaElement {
    const wrap = parent.createDiv({ attr: { style: "margin-bottom:10px" } });
    wrap.createEl("label", { text: label, attr: { style: "display:block;font-size:12px;color:var(--text-2);margin-bottom:4px" } });
    const el = wrap.createEl(type, { attr: { placeholder, value, style: "width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;box-sizing:border-box" } }) as HTMLInputElement & HTMLTextAreaElement;
    el.value = value;
    return el;
  }

  private checkbox(parent: HTMLElement, label: string, checked: boolean): HTMLInputElement {
    const wrap = parent.createEl("label", { attr: { style: "display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-2);cursor:pointer" } });
    const input = wrap.createEl("input", { attr: { type: "checkbox" } });
    input.checked = checked;
    wrap.createSpan({ text: label });
    return input;
  }

  private iconPicker(parent: HTMLElement, selected: string): HTMLInputElement {
    const icons = getLucideIconLibrary();
    const state = parent.createEl("input", { attr: { type: "hidden", value: selected } });
    state.value = icons.includes(selected) ? selected : "bot";

    const section = parent.createDiv({ cls: "s-agent-icon-picker" });
    const heading = section.createDiv({ cls: "s-agent-icon-heading" });
    const selectedIcon = heading.createDiv({ cls: "s-agent-icon-selected" });
    const selectedGlyph = selectedIcon.createSpan();
    const selectedName = selectedIcon.createSpan({ cls: "s-agent-icon-selected-name" });
    const copy = heading.createDiv();
    copy.createDiv({ text: "Icono del agente", cls: "s-agent-icon-title" });
    copy.createDiv({ text: "Elegí un icono Lucide; se usará en menciones y mensajes.", cls: "s-agent-icon-description" });

    const search = section.createEl("input", {
      cls: "s-agent-icon-search",
      attr: { type: "search", placeholder: "Buscar iconos: shield, book, code…", "aria-label": "Buscar iconos Lucide" },
    });
    const grid = section.createDiv({ cls: "s-agent-icon-grid" });
    const count = section.createDiv({ cls: "s-agent-icon-count" });

    const updateSelected = () => {
      selectedGlyph.empty();
      setIcon(selectedGlyph, state.value || "bot");
      selectedName.setText(state.value || "bot");
    };
    const render = () => {
      const query = search.value.trim().toLowerCase();
      const matches = icons.filter(icon => !query || icon.includes(query));
      const visible = matches.slice(0, 120);
      grid.empty();
      for (const icon of visible) {
        const button = grid.createEl("button", {
          cls: `s-agent-icon-option${icon === state.value ? " is-selected" : ""}`,
          attr: { type: "button", title: icon, "aria-label": `Usar icono ${icon}`, "aria-pressed": String(icon === state.value) },
        });
        setIcon(button, icon);
        button.onclick = () => {
          state.value = icon;
          updateSelected();
          render();
        };
      }
      count.setText(matches.length > visible.length
        ? `${visible.length} de ${matches.length} iconos; refiná la búsqueda para ver más.`
        : `${matches.length} iconos disponibles.`);
    };
    search.addEventListener("input", render);
    updateSelected();
    render();
    return state;
  }

  private finish(value: AgentGenerationResult | null): void {
    this.result = value;
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.resolve) this.resolve(this.result);
  }
}
