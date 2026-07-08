import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, TFile } from "obsidian";
import { VIEW_TYPE_SANCTUM } from "../constants";
import type { AgentDefinition } from "../agents/types";
import type { MeshResultFull } from "../orchestrator/mesh";

const CHAT_HISTORY_PATH = "sanctum-logs/chat-history.json";

export interface ChatViewPlugin {
  agent: AgentDefinition | null;
  agentName: string;
  vectorStore: { count: number };
  activeFolder: string | null;
  sendChatMessage(msg: string): Promise<string>;
  indexResearch(folder?: string): Promise<void>;
  setActiveFolder(folder: string | null): void;
  runOrchestrate(prompt: string): Promise<void>;
  createNoteWithAI(): Promise<void>;
  testEmbeddings(): Promise<void>;
  testChat(): Promise<void>;
  runMesh(prompt: string): Promise<MeshResultFull>;
  getLatestTrace(): Promise<string>;
}

interface ChatMessage {
  role: "user" | "agent";
  content: string;
  label?: string;
}

export class SanctumChatView extends ItemView {
  private plugin: ChatViewPlugin;
  private messages: ChatMessage[] = [];
  private msgEl: HTMLElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private meshMode = false;
  private meshBtn: HTMLButtonElement;
  private dropdownEl: HTMLElement;
  private availableAgents: { id: string; name: string; avatar: string }[] = [];
  private activeQuery: { startIdx: number; endIdx: number; text: string } | null = null;
  private filteredOptions: { type: "agent" | "note"; label: string; value: string; detail?: string; avatar?: string }[] = [];
  private highlightedIndex = 0;

  constructor(leaf: WorkspaceLeaf, plugin: ChatViewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SANCTUM;
  }

  getDisplayText(): string {
    return "Sanctum II";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.style.cssText = "display:flex;flex-direction:column;height:100%;position:relative";

    const agentEmoji = this.plugin.agent?.avatar || "🤖";
    const agentName = this.plugin.agentName;
    const idxCount = this.plugin.vectorStore.count;
    container.createEl("h3", { text: `Sanctum II — ${agentEmoji} ${agentName} (${idxCount} chunks)` });

    const actionsEl = container.createDiv();
    actionsEl.style.cssText = "display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center";

    // Folder selector
    const folderSelect = actionsEl.createEl("select");
    folderSelect.style.cssText = "font-size:12px;padding:2px 4px;max-width:160px";
    const defaultOpt = folderSelect.createEl("option", { text: "📂 Todo /Research/", value: "" });
    defaultOpt.selected = true;
    this.loadFolderList(folderSelect).catch(() => {});

    const makeBtn = (text: string, bg: string, onClick: () => void) => {
      const btn = actionsEl.createEl("button", { text });
      btn.style.cssText = `background:${bg};color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px`;
      btn.addEventListener("click", onClick);
    };

    makeBtn("📚 Indexar", "var(--color-blue)", () => {
      const folder = folderSelect.value || undefined;
      this.plugin.indexResearch(folder);
    });

    folderSelect.addEventListener("change", () => {
      this.plugin.setActiveFolder(folderSelect.value || null);
      folderSelect.style.border = folderSelect.value ? "1px solid var(--interactive-accent)" : "none";
    });
    makeBtn("🔍 RAG", "var(--color-purple)", () => this.plugin.runOrchestrate("¿Qué dice /Research/?"));
    makeBtn("✏️ Nota IA", "var(--color-cyan)", () => this.plugin.createNoteWithAI());
    makeBtn("🧪 Embeddings", "var(--interactive-accent)", () => this.plugin.testEmbeddings());
    makeBtn("💬 Chat test", "var(--color-green)", () => this.plugin.testChat());
    // --- Mesh toggle button (separate from makeBtn to keep reference) ---
    this.meshBtn = actionsEl.createEl("button", { text: "🔀 Mesh" });
    this.updateMeshBtnStyle();
    this.meshBtn.addEventListener("click", () => this.toggleMeshMode());

    makeBtn("📋 Último trace", "var(--text-muted)", () => this.handleShowTrace());
    makeBtn("🧹 Limpiar Chat", "var(--text-muted)", () => this.clearChatHistory());

    this.msgEl = container.createDiv({ cls: "sanctum-messages" });
    this.msgEl.style.cssText = "flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px";

    this.loadChatHistory().then((loaded) => {
      if (!loaded) {
        this.addMessage("agent", `Bienvenido. Indexá /Research/ y preguntale a @${agentName}.`, `${agentEmoji} ${agentName}`);
      }
    });

    const inputRow = container.createDiv();
    inputRow.style.cssText = "display:flex;gap:8px;padding:8px 0";
    this.input = inputRow.createEl("input", {
      attr: { type: "text", placeholder: `Mensaje para ${agentName}...` },
    });
    this.input.style.cssText = "flex:1;padding:6px 8px";
    this.sendBtn = inputRow.createEl("button", { text: "Enviar" });
    this.sendBtn.style.cssText = "padding:6px 16px";

    this.dropdownEl = container.createDiv({ cls: "sanctum-autocomplete" });

    this.sendBtn.onclick = () => this.dispatchSend();
    this.input.onkeydown = (e) => this.handleKeyDown(e);
    this.input.addEventListener("input", () => this.handleInput());
    this.input.addEventListener("keyup", (e) => {
      if (e.key === "@") {
        this.handleInput();
      }
    });

    this.loadAutocompleteData().then(() => {
      console.log("Sanctum: agents loaded", this.availableAgents);
    });
  }

  private addMessage(role: "user" | "agent", content: string, label?: string): void {
    this.messages.push({ role, content, label });
    this.renderMessages();
    this.saveChatHistory();
  }

  private renderMessages(): void {
    this.msgEl.empty();
    for (const msg of this.messages) {
      const wrapper = this.msgEl.createDiv();
      wrapper.style.cssText = `
        display:flex;flex-direction:column;
        align-items:${msg.role === "user" ? "flex-end" : "flex-start"};
      `;

      const bubble = wrapper.createDiv();
      bubble.style.cssText = `
        max-width:85%;padding:8px 12px;border-radius:8px;word-wrap:break-word;
        background:${msg.role === "user" ? "var(--interactive-accent)" : "var(--background-secondary)"};
        color:${msg.role === "user" ? "#fff" : "var(--text-normal)"};
      `;

      if (msg.role === "user") {
        bubble.setText(msg.content);
      } else {
        bubble.createEl("small", {
          text: msg.label || `${this.plugin.agent?.avatar || "🤖"} ${this.plugin.agentName}`,
          cls: "sanctum-agent-label",
        });
        const mdEl = bubble.createDiv();
        mdEl.style.cssText = "margin-top:4px";
        MarkdownRenderer.renderMarkdown(msg.content, mdEl, "", this.plugin);
      }

      const copyBtn = wrapper.createEl("button", { text: "📋" });
      copyBtn.style.cssText = `
        border:none;background:transparent;cursor:pointer;font-size:11px;
        padding:2px 6px;opacity:0.4;
      `;
      copyBtn.title = "Copiar mensaje";
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(msg.content).then(() => {
          copyBtn.textContent = "✅";
          setTimeout(() => { copyBtn.textContent = "📋"; }, 1500);
        }).catch(() => {
          new Notice("No se pudo copiar al portapapeles");
        });
      };
    }
    this.msgEl.scrollTo({ top: this.msgEl.scrollHeight, behavior: "smooth" });
  }

  private async dispatchSend(): Promise<void> {
    if (this.meshMode) {
      return this.handleMesh();
    }
    return this.handleSend();
  }

  private async handleSend(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) return;

    this.addMessage("user", text);
    this.input.value = "";
    this.input.disabled = true;
    this.sendBtn.disabled = true;

    let agentEmoji = this.plugin.agent?.avatar || "🤖";
    let agentLabel = `${agentEmoji} ${this.plugin.agentName}`;

    const mentionMatch = text.match(/^@([\w\-]+)/);
    if (mentionMatch) {
      const targetAgent = this.availableAgents.find(a => a.id === mentionMatch[1]);
      if (targetAgent) {
        agentEmoji = targetAgent.avatar;
        agentLabel = `${targetAgent.avatar} ${targetAgent.name}`;
      }
    }

    this.addMessage("agent", `${agentEmoji} pensando...`, agentLabel);

    const response = await this.plugin.sendChatMessage(text);

    this.messages.pop();
    this.addMessage("agent", response, agentLabel);

    this.input.disabled = false;
    this.sendBtn.disabled = false;
    this.input.focus();
  }

  private toggleMeshMode(): void {
    this.meshMode = !this.meshMode;
    this.updateMeshBtnStyle();
    const agentName = this.plugin.agentName;
    if (this.meshMode) {
      this.input.placeholder = "🔀 Pregunta para mesh Forager→Researcher→Critic...";
      this.sendBtn.textContent = "🔀 Enviar";
      this.addMessage("agent", "Modo **Mesh** activado. Tu próximo mensaje se enviará al pipeline Forager→Researcher→Critic.", "🔀 Mesh");
    } else {
      this.input.placeholder = `Mensaje para ${agentName}...`;
      this.sendBtn.textContent = "Enviar";
      this.addMessage("agent", `Modo normal. Mensajes van a @${agentName}.`, `${this.plugin.agent?.avatar || "🤖"} ${agentName}`);
    }
    this.input.focus();
  }

  private updateMeshBtnStyle(): void {
    const active = this.meshMode;
    this.meshBtn.style.cssText = `background:${active ? "#e67e22" : "#888"};color:#fff;border:${active ? "2px solid #fff" : "none"};padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:${active ? "bold" : "normal"};opacity:${active ? "1" : "0.7"}`;
    this.meshBtn.textContent = active ? "🔀 Mesh ON" : "🔀 Mesh";
    this.meshBtn.title = active ? "Click para desactivar modo Mesh" : "Click para activar modo Mesh (Enter enviará al pipeline Forager→Researcher→Critic)";
  }

  private async handleMesh(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) {
      this.addMessage("agent", "Escribí una pregunta para ejecutar el mesh Forager→Researcher→Critic.", "🔀 Mesh");
      return;
    }

    this.addMessage("user", text);
    this.input.value = "";
    this.input.disabled = true;
    this.sendBtn.disabled = true;

    this.addMessage("agent", "🔀 Ejecutando mesh Forager→Researcher→Critic...", "🔀 Mesh");

    const result = await this.plugin.runMesh(text);

    this.messages.pop();

    const label = `🔍 Forager → 📚 Researcher (×${result.attempts}) → ⚖️ Critic`;

    if (result.criticVerdict === "escalated") {
      const escaladoMsg = `### ⚠️ Mesh escalado al usuario\n\n` +
        `El Critic rechazó los ${result.loopState.max_attempts} intentos del Researcher.\n\n` +
        `**Mejor score:** ${result.criticScore}/100\n\n` +
        `**Feedback del Critic:**\n${(result.loopState.history.filter(h => h.agent === "critic").pop()?.feedback || []).map(f => `- ${f}`).join("\n")}\n\n` +
        `---\n\n**Mejor intento del Researcher:**\n${result.researcherOutput}`;
      this.addMessage("agent", escaladoMsg, label);
    } else {
      let acceptMsg = `${result.researcherOutput}\n\n---\n**⚖️ Evaluación del Critic:** Aceptado con ${result.criticScore}/100.`;
      if (result.createdNotePath) {
        const noteName = result.createdNotePath.replace(/\.md$/i, "");
        acceptMsg += `\n\n📁 Nota guardada exitosamente en: [[${noteName}]]`;
      }
      this.addMessage("agent", acceptMsg, label);
    }

    this.input.disabled = false;
    this.sendBtn.disabled = false;
    this.input.focus();
  }

  private async handleShowTrace(): Promise<void> {
    this.input.disabled = true;
    this.sendBtn.disabled = true;
    this.addMessage("agent", "📋 Leyendo último trace...", "📋 Tracer");
    const trace = await this.plugin.getLatestTrace();
    this.messages.pop();
    this.addMessage("agent", trace, "📋 Tracer");
    this.input.disabled = false;
    this.sendBtn.disabled = false;
    this.input.focus();
  }

  private async saveChatHistory(): Promise<void> {
    try {
      await this.app.vault.adapter.write(CHAT_HISTORY_PATH, JSON.stringify(this.messages, null, 2));
    } catch {}
  }

  private async loadChatHistory(): Promise<boolean> {
    try {
      const exists = await this.app.vault.adapter.exists(CHAT_HISTORY_PATH);
      if (!exists) return false;
      const raw = await this.app.vault.adapter.read(CHAT_HISTORY_PATH);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.messages = parsed;
        this.renderMessages();
        return true;
      }
    } catch {}
    return false;
  }

  private async clearChatHistory(): Promise<void> {
    this.messages = [];
    try {
      await this.app.vault.adapter.write(CHAT_HISTORY_PATH, JSON.stringify([]));
    } catch {}
    const agentEmoji = this.plugin.agent?.avatar || "🤖";
    const agentName = this.plugin.agentName;
    this.addMessage("agent", `Bienvenido. Indexá /Research/ y preguntale a @${agentName}.`, `${agentEmoji} ${agentName}`);
  }

  private async loadFolderList(select: HTMLSelectElement): Promise<void> {
    try {
      const listing = await this.app.vault.adapter.list("Research");
      for (const folder of listing.folders) {
        const label = folder.replace(/^Research[\/\\]?/, "");
        select.createEl("option", { text: `📁 ${label}`, value: folder });
      }
    } catch {}
  }

  private async loadAutocompleteData(): Promise<void> {
    const agents: { id: string; name: string; avatar: string }[] = [];
    try {
      const files = await this.app.vault.adapter.list("sanctum-agents");
      const mdFiles = files.files.filter((f: string) => f.endsWith(".md"));
      for (const path of mdFiles) {
        try {
          const content = await this.app.vault.adapter.read(path);
          const parts = content.split("---");
          if (parts.length >= 3) {
            const fm = parts[1];
            const id = fm.match(/^id:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
            if (!id) continue;
            const internal = fm.match(/^internal:\s*(true|false)$/m)?.[1] === "true";
            if (internal) continue;
            const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || id;
            const avatar = fm.match(/^avatar:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "🤖";
            agents.push({ id, name, avatar });
          }
        } catch {}
      }
    } catch {}
    this.availableAgents = agents;
  }

  private getAutocompleteQuery(): { startIdx: number; endIdx: number; text: string } | null {
    const cursorPos = this.input.selectionStart ?? 0;
    const val = this.input.value;
    let atIdx = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (val[i] === "@") {
        if (i === 0 || val[i - 1] === " ") {
          atIdx = i;
          break;
        }
        break;
      }
      if (val[i] === " ") break;
    }
    if (atIdx === -1) return null;
    const text = val.slice(atIdx + 1, cursorPos);
    if (text.includes(" ")) return null;
    return { startIdx: atIdx, endIdx: cursorPos, text };
  }

  private handleInput(): void {
    try {
      const query = this.getAutocompleteQuery();
      this.activeQuery = query;

      if (!query) {
        this.closeDropdown();
        return;
      }

      const queryLower = query.text.toLowerCase();

      const agents = this.availableAgents
        .filter(a => a.name.toLowerCase().includes(queryLower) || a.id.toLowerCase().includes(queryLower))
        .map(a => ({ type: "agent" as const, label: a.name, value: a.id, detail: `@${a.id}`, avatar: a.avatar }));

      let notes: { type: "agent" | "note"; label: string; value: string; detail?: string; avatar?: string }[] = [];
      try {
        const mdFiles = this.app.vault.getMarkdownFiles();
        for (const file of mdFiles) {
          if (file.path.startsWith("sanctum-agents/")) continue;
          const basename = file.basename.toLowerCase();
          if (basename.includes(queryLower) || file.path.toLowerCase().includes(queryLower)) {
            notes.push({ type: "note", label: file.basename, value: `[[${file.path}]]`, detail: file.path, avatar: "📄" });
            if (notes.length >= 10) break;
          }
        }
      } catch {}

      this.filteredOptions = [...agents, ...notes];
      this.highlightedIndex = 0;

      if (this.filteredOptions.length === 0) {
        this.closeDropdown();
        return;
      }

      this.renderDropdown();
    } catch (err) {
      console.error("Sanctum autocomplete error:", err);
    }
  }

  private renderDropdown(): void {
    this.dropdownEl.empty();
    this.dropdownEl.classList.add("is-visible");

    for (let i = 0; i < this.filteredOptions.length; i++) {
      const opt = this.filteredOptions[i];
      const item = this.dropdownEl.createDiv({ cls: "sanctum-autocomplete-item" });
      if (i === this.highlightedIndex) item.classList.add("is-highlighted");

      item.createSpan({ cls: "avatar", text: opt.avatar || "🤖" });
      item.createSpan({ cls: "label", text: opt.label });
      if (opt.detail) item.createSpan({ cls: "detail", text: opt.detail });

      item.dataset.index = String(i);
      item.onclick = () => this.selectOption(i);
      item.onmouseenter = () => {
        const prev = this.dropdownEl.querySelector(".is-highlighted");
        if (prev) prev.classList.remove("is-highlighted");
        this.highlightedIndex = i;
        item.classList.add("is-highlighted");
      };
    }
  }

  private selectOption(index: number): void {
    const opt = this.filteredOptions[index];
    if (!opt || !this.activeQuery) return;

    const val = this.input.value;
    let insertText: string;
    if (opt.type === "agent") {
      insertText = `@${opt.value} `;
    } else {
      insertText = `${opt.value} `;
    }

    this.input.value = val.slice(0, this.activeQuery.startIdx) + insertText + val.slice(this.activeQuery.endIdx);
    const newPos = this.activeQuery.startIdx + insertText.length;
    this.input.selectionStart = newPos;
    this.input.selectionEnd = newPos;
    this.input.focus();
    this.closeDropdown();
  }

  private closeDropdown(): void {
    this.dropdownEl.classList.remove("is-visible");
    this.activeQuery = null;
    this.filteredOptions = [];
    this.highlightedIndex = 0;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const isVisible = this.dropdownEl.classList.contains("is-visible");

    if (isVisible && this.filteredOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.highlightedIndex = (this.highlightedIndex + 1) % this.filteredOptions.length;
        this.renderDropdown();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.highlightedIndex = (this.highlightedIndex - 1 + this.filteredOptions.length) % this.filteredOptions.length;
        this.renderDropdown();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.selectOption(this.highlightedIndex);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeDropdown();
        this.input.focus();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.dispatchSend();
    }
  }
}
