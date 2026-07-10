import { Modal, App, setIcon } from "obsidian";

const LUCIDE_ICONS = [
  "bot", "search", "book-open", "scale", "globe", "zap", "star", "heart",
  "eye", "eye-off", "bell", "message-square", "mail", "phone", "camera",
  "image", "music", "video", "file-text", "folder", "folder-open",
  "clock", "calendar", "map", "compass", "flag", "award", "crown",
  "shield", "lock", "unlock", "key", "wrench", "hammer", "tool",
  "scissors", "pen-tool", "palette", "paint-bucket", "droplet",
  "sun", "moon", "cloud", "cloud-rain", "cloud-snow", "wind",
  "thermometer", "activity", "bar-chart", "pie-chart", "trending-up",
  "users", "user-plus", "user-check", "user-x", "user-minus",
  "smile", "frown", "meh", "thumbs-up", "thumbs-down",
  "check", "x", "alert-circle", "alert-triangle", "info",
  "help-circle", "question", "plus-circle", "minus-circle",
  "link", "external-link", "paperclip", "anchor", "hash",
  "at-sign", "terminal", "cpu", "database", "server",
  "layers", "cast", "globe", "smartphone", "tablet", "laptop",
  "monitor", "watch", "radio", "wifi", "bluetooth",
];

interface AgentGeneratorResult {
  id: string;
  name: string;
  icon: string;
  description: string;
  tools: string[];
  instructions: string;
  read_paths: string[];
  write_paths: string[];
}

export class AgentGeneratorModal extends Modal {
  private result: AgentGeneratorResult | null = null;
  private resolve!: (value: AgentGeneratorResult | null) => void;

  private selectedIcon = "bot";
  private agentName = "";
  private agentDesc = "";
  private agentInstructions = "";
  private step: "name" | "icon" | "purpose" | "instructions" = "name";

  constructor(app: App) {
    super(app);
    this.contentEl.style.maxWidth = "600px";
  }

  async ask(): Promise<AgentGeneratorResult | null> {
    return new Promise((res) => { this.resolve = res; this.open(); });
  }

  onOpen(): void {
    this.renderNameStep();
  }

  private renderNameStep(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.step = "name";

    contentEl.createDiv({ text: "🤖 Crear nuevo agente", attr: { style: "font-weight:700;font-size:16px;margin-bottom:16px" } });

    contentEl.createEl("label", { text: "Nombre del agente", attr: { style: "font-size:12px;color:var(--text-3);display:block;margin-bottom:4px" } });
    const nameInput = contentEl.createEl("input", { attr: { type: "text", placeholder: "Ej: Analista de Datos", style: "width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;outline:none;box-sizing:border-box" } });
    nameInput.focus();

    contentEl.createEl("label", { text: "Descripción corta", attr: { style: "font-size:12px;color:var(--text-3);display:block;margin-top:10px;margin-bottom:4px" } });
    const descInput = contentEl.createEl("input", { attr: { type: "text", placeholder: "Ej: Analiza datasets financieros", style: "width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;outline:none;box-sizing:border-box" } });

    contentEl.createEl("label", { text: "Tools (separadas por coma)", attr: { style: "font-size:12px;color:var(--text-3);display:block;margin-top:10px;margin-bottom:4px" } });
    const toolsInput = contentEl.createEl("input", { attr: { type: "text", value: "rag_query", style: "width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;outline:none;box-sizing:border-box" } });

    const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;margin-top:16px;justify-content:flex-end" } });
    btnRow.createEl("button", { text: "Cancelar", attr: { style: "padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-2);cursor:pointer" } }).onclick = () => { this.result = null; this.close(); };
    const nextBtn = btnRow.createEl("button", { text: "Seleccionar icono →", attr: { style: "padding:6px 14px;border-radius:6px;border:none;background:var(--brand);color:#fff;cursor:pointer;font-weight:600" } });
    nextBtn.onclick = () => {
      this.agentName = nameInput.value.trim();
      this.agentDesc = descInput.value.trim();
      const tools = toolsInput.value.split(",").map(s => s.trim()).filter(Boolean);
      this.agentInstructions = `Eres ${this.agentName || "un asistente"}. ${this.agentDesc}`;
      if (!this.agentName) { nameInput.focus(); return; }
      this.renderIconStep();
    };
  }

  private renderIconStep(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.step = "icon";

    contentEl.createDiv({ text: `🖼️ Seleccioná un icono para "${this.agentName}"`, attr: { style: "font-weight:700;font-size:14px;margin-bottom:12px" } });

    const grid = contentEl.createDiv({ attr: { style: "display:grid;grid-template-columns:repeat(8,1fr);gap:4px;max-height:200px;overflow-y:auto;padding:4px" } });

    for (const iconName of LUCIDE_ICONS) {
      const cell = grid.createDiv({ attr: { style: "width:36px;height:36px;border-radius:6px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .1s" } });
      setIcon(cell, iconName);
      cell.dataset.icon = iconName;
      cell.onclick = () => {
        grid.querySelectorAll("[data-icon]").forEach(el => (el as HTMLElement).style.borderColor = "var(--border)");
        cell.style.borderColor = "var(--brand)";
        cell.style.background = "var(--brand-soft)";
        this.selectedIcon = iconName;
      };
      if (iconName === this.selectedIcon) {
        cell.style.borderColor = "var(--brand)";
        cell.style.background = "var(--brand-soft)";
      }
    }

    const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;margin-top:12px;justify-content:space-between" } });
    btnRow.createEl("button", { text: "← Atrás", attr: { style: "padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-2);cursor:pointer" } }).onclick = () => this.renderNameStep();
    const finishBtn = btnRow.createEl("button", { text: "✅ Crear agente", attr: { style: "padding:6px 14px;border-radius:6px;border:none;background:var(--brand);color:#fff;cursor:pointer;font-weight:600" } });
    finishBtn.onclick = () => {
      const id = this.agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agente-personalizado";
      this.result = {
        id,
        name: this.agentName,
        icon: this.selectedIcon,
        description: this.agentDesc || `Agente personalizado: ${this.agentName}`,
        tools: ["rag_query"],
        instructions: this.agentInstructions,
        read_paths: ["/**"],
        write_paths: [],
      };
      this.close();
    };
  }

  private serializeAgent(r: AgentGeneratorResult): string {
    return `---
id: ${r.id}
name: "${r.name}"
avatar: "${r.icon}"
description: "${r.description}"
tools: [${r.tools.join(", ")}]
permissions:
  read_paths: ["${r.read_paths.join("\", \"")}"]
  write_paths: ${r.write_paths.length ? `["${r.write_paths.join("\", \"")}"]` : "[]"}
---
${r.instructions}

{{rag_context}}

{{user_prompt}}`;
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.resolve) this.resolve(this.result);
  }
}
