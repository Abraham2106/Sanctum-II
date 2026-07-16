import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type { AgentDefinition } from "../agents/types";
import type { MeshResultFull } from "../orchestrator/mesh";
import { VIEW_TYPE_SANCTUM } from "../constants";
import { ChatLeftPanel } from "./chat-left";
import { ChatComposer } from "./chat-composer";
import { ChatRightPanel } from "./chat-right";
import { ChatMessages } from "./chat-messages";
import { ChatAutocomplete } from "./chat-autocomplete";
import type { ChatViewPlugin, ChatMessage, RailAgent } from "./chat-types";
import type { SkillAuthoringProgress } from "../skills/authoring/types";

export { ChatViewPlugin, ChatMessage };

export class SanctumChatView extends ItemView {
  // Plugin interface (delegated to the real plugin)
  private plugin: ChatViewPlugin;
  private opened = false;

  // Modules
  private left!: ChatLeftPanel;
  private composer!: ChatComposer;
  private right!: ChatRightPanel;
  private messenger!: ChatMessages;
  private autocomplete!: ChatAutocomplete;

  // State exposed to modules
  meshMode = false;
  threadId = "";
  selectedRailAgent: RailAgent | null = null;
  private conversationSummary: string | undefined;

  // DOM references
  private threadEl!: HTMLElement;
  private leftEl!: HTMLElement;

  // Agent autocomplete data
  private availableAgents: RailAgent[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: ChatViewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_SANCTUM; }
  getDisplayText(): string { return "Sanctum II"; }
  getIcon(): string { return "bot"; }

  setThreadId(id: string): void {
    if (this.threadId !== id) this.conversationSummary = undefined;
    this.threadId = id;
    if (this.messenger) this.messenger.setThreadId(id);
  }

  async postMessage(text: string): Promise<void> {
    this.messenger.messages = [];
    if (this.threadEl) this.threadEl.empty();
    const loaded = await this.messenger.loadThreadMessages();
    await this.loadConversationSummary();
    if (!loaded) {
      this.messenger.addMsg("agent",
        `Bienvenido a **Sanctum-II** · Proyecto: **${this.plugin.getActiveProjectName()}** ${this.plugin.getActiveProjectIcon()}.`,
        `bot ${this.plugin.agentName}`);
    }
    this.composer.inputEl.value = text;
    this.composer.inputEl.disabled = false;
    this.composer.sendBtn.disabled = false;
    await this.handleSend();
  }

  async reloadForProject(threadId: string): Promise<void> {
    this.threadId = threadId;
    if (!this.messenger) return;
    this.messenger.setProjectContext(this.plugin.getActiveProjectId());
    this.messenger.setThreadId(threadId);
    this.conversationSummary = undefined;
    this.messenger.messages = [];
    if (this.threadEl) {
      this.threadEl.empty();
      const loaded = await this.messenger.loadThreadMessages();
      await this.loadConversationSummary();
      if (!loaded) {
        this.messenger.addMsg("agent",
          `Bienvenido a **Sanctum-II** · Proyecto: **${this.plugin.getActiveProjectName()}** ${this.plugin.getActiveProjectIcon()}.`,
          `bot ${this.plugin.agentName}`);
      }
    }
  }

  async onOpen(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("sanctum-root");

    const leftEl = this.leftEl = container.createDiv({ cls: "s-left" });
    const centerEl = container.createDiv({ cls: "s-center" });
    const rightEl = container.createDiv({ cls: "s-right" });

    // Initialize modules
    this.left = new ChatLeftPanel(this.plugin);
    this.composer = new ChatComposer(this.plugin);
    this.right = new ChatRightPanel();
    this.messenger = new ChatMessages(this.plugin);
    this.autocomplete = new ChatAutocomplete(this.plugin, () => this.app);

    // Build panels — left uses parent (s-left), right creates s-right inside
    this.left.build(leftEl, this.availableAgents);
    this.composer.build(centerEl, {
      onSend: () => this.dispatchSend(),
      onToggleMesh: () => this.toggleMeshMode(),
    });
    this.right.build(rightEl);

    // Subscribe to composer events — combine autocomplete + send
    let autoCompleteHandled = false;
    this.autocomplete.setOnSelect(() => { autoCompleteHandled = true; });
    this.composer.inputEl.onkeydown = (e) => {
      autoCompleteHandled = false;
      this.autocomplete.handleKeyDown(e);
      // If autocomplete just handled Enter, don't send
      if (autoCompleteHandled) return;
      const dropVisible = this.composer.dropdownEl?.classList.contains("is-visible");
      if (e.key === "Enter" && !e.shiftKey && !dropVisible) {
        e.preventDefault();
        this.dispatchSend();
      }
    };

    // Gather thread element from the DOM (composer creates it)
    const threadWrapper = centerEl.querySelector(".s-thread") as HTMLElement;
    this.threadEl = threadWrapper?.querySelector(".s-thread-inner") as HTMLElement;

    // Initialize messenger
    this.messenger.init(this.threadEl, this.threadId, () => { /* auto-save on add */ }, this.plugin.getActiveProjectId());
    this.messenger.setThreadId(this.threadId);

    // Initialize autocomplete
    this.autocomplete.init(this.composer.inputEl, this.composer.dropdownEl, (skillId, skillName) => {
      if (this.plugin.setSkillContext) this.plugin.setSkillContext(skillId);
      this.composer.setActiveSkill(skillName || null);
    });

    // Load autocomplete data
    this.autocomplete.loadData().then(() => {
      this.availableAgents = this.autocomplete.getAgents();
      // Rebuild left with agents
      this.left.build(leftEl, this.availableAgents);
    });

    // Load welcome message
    this.messenger.loadThreadMessages().then(async loaded => {
      await this.loadConversationSummary();
      if (!loaded) {
        this.messenger.addMsg("agent",
          `Bienvenido a **Sanctum-II** · Proyecto: **${this.plugin.getActiveProjectName()}**. Indexá tu carpeta de investigación y haceme preguntas usando \`@\` para mencionar agentes.`,
          `bot ${this.plugin.agentName}`);
      }
    });
  }

  /** Reloads agent/skill suggestions after a definition is created or edited. */
  async refreshAgentAutocomplete(): Promise<void> {
    if (!this.autocomplete) return;
    await this.autocomplete.loadData();
    this.availableAgents = this.autocomplete.getAgents();
    if (this.leftEl && this.left) this.left.build(this.leftEl, this.availableAgents);
  }

  private async loadConversationSummary(): Promise<void> {
    const projectId = this.plugin.getActiveProjectId();
    if (!projectId || !this.threadId || !this.plugin.loadConversationSummaryForProject) return;
    try {
      this.conversationSummary = await this.plugin.loadConversationSummaryForProject(projectId, this.threadId);
    } catch (err: any) {
      console.warn("[Chat] load conversation summary:", err?.message || err);
    }
  }

  // ── Send / Mesh handlers ──

  private async dispatchSend(): Promise<void> {
    if (this.meshMode) await this.handleMesh();
    else await this.handleSend();
  }

  private async handleSend(): Promise<void> {
    const text = this.composer.inputEl.value.trim();
    if (!text) return;

    this.composer.inputEl.disabled = true;
    this.composer.sendBtn.disabled = true;

    // Detect @agent mention
    const mentionMatch = text.trim().match(/^@([\w\-]+)(?:\s+([\s\S]*))?$/);
    const isSkillCreator = /^\/skill-creator(?:\s|$)/i.test(text);
    let agentLabel = `bot ${this.plugin.agentName}`;
    let iconId = "bot";

    if (mentionMatch) {
      const targetAgentId = mentionMatch[1];
      const found = this.availableAgents.find(a => a.id === targetAgentId);
      if (found) {
        iconId = found.avatar || "bot";
        agentLabel = `${iconId} ${found.name}`;
      }
    } else if (isSkillCreator) {
      iconId = "wand-sparkles";
      agentLabel = `${iconId} Skill Creator`;
    }

    this.composer.inputEl.value = "";
    // The current turn is passed separately; exclude it from history to avoid
    // duplicating the user message in the LLM payload.
    const history = this.messenger.messages.map(m => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.content }));
    this.messenger.addMsg("user", text);
    this.messenger.addMsg("agent", isSkillCreator ? "Iniciando mesh contextual de autoría…" : "Pensando...", agentLabel);
    const thinkingEl = this.threadEl.lastElementChild;
    try {
      const onSkillProgress = isSkillCreator
        ? (progress: SkillAuthoringProgress) => this.composer.showSkillAuthoringPipeline(progress)
        : undefined;
      if (isSkillCreator) this.composer.showSkillAuthoringPipeline({ stage: "rag", message: "Preparando contexto…" });
      const response = await this.plugin.sendChatMessage(text, history, this.conversationSummary, onSkillProgress);
      const responseContent = typeof response === "string" ? response : response.content;
      if (typeof response !== "string" && response.conversationSummary !== undefined) this.conversationSummary = response.conversationSummary;
      this.messenger.messages.pop();
      thinkingEl?.remove();
      this.messenger.addMsg("agent", responseContent, agentLabel);
    } catch (err: any) {
      this.messenger.messages.pop();
      thinkingEl?.remove();
      this.messenger.addMsg("agent", `Error: ${err.message}`, "bot Error");
    }
    this.composer.inputEl.disabled = false;
    this.composer.sendBtn.disabled = false;
    this.composer.inputEl.focus();
  }

  private async handleMesh(): Promise<void> {
    const text = this.composer.inputEl.value.trim();
    if (!text) {
      this.messenger.addMsg("agent", "Escribí una pregunta para ejecutar el mesh Forager→Researcher→Critic.", "shuffle Mesh");
      return;
    }

    this.messenger.addMsg("user", text);
    this.composer.inputEl.value = "";
    this.composer.inputEl.disabled = true;
    this.composer.sendBtn.disabled = true;

    this.messenger.addMsg("agent", "Ejecutando pipeline Forager → Researcher → Critic…", "shuffle Mesh");
    this.composer.showPipeline(true, "forager");

    try {
      const result = await this.plugin.runMesh(text);
      this.composer.showPipeline(true, "done", result.criticScore, result.attempts);

    this.messenger.messages.pop();
    this.threadEl.lastElementChild?.remove();

    const label = `search Forager → Researcher ×${result.attempts} → Critic`;

    if (result.criticVerdict === "escalated") {
      const wrap = this.threadEl.createDiv({ cls: "s-msg-agent" });
      const meta = wrap.createDiv({ cls: "s-msg-meta" });
      const avatar = meta.createDiv({ cls: "s-msg-avatar" });
      setIcon(avatar, "alert-triangle");
      meta.createDiv({ cls: "s-msg-name", text: `Forager → Researcher ×${result.attempts} → Critic` });
      meta.createDiv({ cls: "s-msg-time", text: `Score: ${result.criticScore}/100` });

      const band = wrap.createDiv({ cls: "s-escalation" });
      band.createDiv({ text: `El Critic rechazó los ${result.loopState.max_attempts} intentos del Researcher.`, attr: { style: "font-weight:600;margin-bottom:6px" } });
      const feedback = result.loopState.history.filter(h => h.agent === "critic").pop()?.feedback || [];
      if (feedback.length) {
        const ul = band.createEl("ul", { attr: { style: "margin:6px 0 0;padding-left:16px;font-size:12.5px" } });
        feedback.forEach((f: string) => ul.createEl("li", { text: f }));
      }
      this.messenger.messages.push({ role: "agent", content: `[escalated] ${result.researcherOutput}`, label, timestamp: Date.now() });
    } else {
      let acceptMsg = `${result.researcherOutput}\n\n---\n**Evaluación del Critic:** Aceptado con ${result.criticScore}/100.`;
      if (result.createdNotePath) {
        const noteName = result.createdNotePath.replace(/\.md$/i, "");
        acceptMsg += `\n\nNota guardada en: [[${noteName}]]`;
      }
      this.messenger.addMsg("agent", acceptMsg, label, { meshMeta: { attempts: result.attempts, score: result.criticScore, verdict: "accept" } });
      // Mini score bar
      const msgEl = this.threadEl.lastElementChild;
      if (msgEl) {
        const progWrap = msgEl.createDiv({ cls: "s-msg-prog" });
        const attempts = result.loopState?.attempts;
        if (attempts?.length) {
          const prog = progWrap.createDiv({ cls: "s-mini-prog" });
          for (const a of attempts) {
            const dot = prog.createDiv({ cls: `s-mini-prog-dot${a.total_score >= 80 ? " ok" : a.total_score >= 50 ? " mid" : " low"}` });
            dot.style.width = `${Math.max(10, (a.total_score / 100) * 24)}px`;
            dot.title = `Intento ${a.attempt}: ${a.total_score}/100`;
          }
        }
      }
    }

      this.right.renderTracePanel(result);
    } catch (err: any) {
      this.messenger.messages.pop();
      this.threadEl.lastElementChild?.remove();
      this.composer.showPipeline(false);
      this.messenger.addMsg("agent", `Error en el mesh: ${err.message}`, "shuffle Error");
    }
    this.composer.inputEl.disabled = false;
    this.composer.sendBtn.disabled = false;
    this.composer.inputEl.focus();
  }

  private toggleMeshMode(): void {
    this.meshMode = !this.meshMode;
    this.composer.modeChatBtn.classList.toggle("active-chat", !this.meshMode);
    this.composer.modeMeshBtn.classList.toggle("active-mesh", this.meshMode);
    this.composer.sendBtn.className = `s-send-btn ${this.meshMode ? "mesh-mode" : "chat-mode"}`;
    this.composer.inputEl.placeholder = this.meshMode
      ? "Pregunta para ejecutar el Mesh..."
      : `Pregunta para ${this.plugin.agentName}...`;
    if (this.meshMode) {
      this.messenger.addMsg("agent", "Modo **Mesh** activado. Tu siguiente mensaje pasará por el pipeline completo.", "shuffle Mesh");
    } else {
      const iconId = "bot";
      this.messenger.addMsg("agent", `Modo **Chat** activado. Mensajes van a @${this.plugin.agentName}.`, `${iconId} ${this.plugin.agentName}`);
    }
  }
}
