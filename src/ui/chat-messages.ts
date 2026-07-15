import { MarkdownRenderer, Notice, setIcon } from "obsidian";
import type { ChatMessage } from "./chat-types";
import type { ChatViewPlugin } from "./chat-types";
import { renderAvatar } from "./chat-types";

export class ChatMessages {
  messages: ChatMessage[] = [];
  private threadEl!: HTMLElement;
  private plugin: ChatViewPlugin;
  private threadId = "";
  private onSave: (() => void) | null = null;

  constructor(plugin: ChatViewPlugin) {
    this.plugin = plugin;
  }

  init(threadEl: HTMLElement, threadId: string, onSave: () => void): void {
    this.threadEl = threadEl;
    this.threadId = threadId;
    this.onSave = onSave;
  }

  load(msgs: ChatMessage[]): void { this.messages = msgs; }
  setThreadId(id: string): void { this.threadId = id; }

  addMsg(role: "user" | "agent", content: string, label?: string, meta?: Partial<ChatMessage>): ChatMessage {
    const msg: ChatMessage = { role, content, label, timestamp: Date.now(), ...meta };
    this.messages.push(msg);
    this.renderMsg(msg);
    this.threadEl.scrollTo({ top: this.threadEl.scrollHeight, behavior: "smooth" });
    this.save();
    return msg;
  }

  renderAll(): void {
    this.threadEl.empty();
    for (const msg of this.messages) this.renderMsg(msg);
    this.threadEl.scrollTo({ top: this.threadEl.scrollHeight });
  }

  private renderMsg(msg: ChatMessage): void {
    if (msg.role === "user") {
      const wrap = this.threadEl.createDiv({ cls: "s-msg-user" });
      wrap.createDiv({ cls: "s-bubble-user", text: msg.content });
      return;
    }

    const wrap = this.threadEl.createDiv({ cls: "s-msg-agent" });
    const meta = wrap.createDiv({ cls: "s-msg-meta" });
    const labelParts = msg.label?.split(" ") || [];
    const iconId = labelParts[0] || "bot";
    const name = labelParts.slice(1).join(" ") || this.plugin.agentName;

    const avatar = meta.createDiv({ cls: "s-msg-avatar" });
    setIcon(avatar, iconId);
    meta.createDiv({ cls: "s-msg-name", text: name });
    if (msg.timestamp) {
      const t = new Date(msg.timestamp);
      meta.createDiv({ cls: "s-msg-time", text: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` });
    }

    const body = wrap.createDiv({ cls: "s-msg-body" });
    const mdEl = body.createDiv();
    MarkdownRenderer.renderMarkdown(msg.content, mdEl, "", this.plugin as any);

    if (msg.sources?.length) {
      const chips = body.createDiv({ cls: "s-source-chips" });
      for (const s of msg.sources) {
        const chip = chips.createDiv({ cls: "s-source-chip" });
        const dot = chip.createDiv({ cls: "s-source-dot" });
        dot.style.opacity = String(Math.max(0.3, s.score));
        chip.createSpan({ text: s.note_path.replace(/^.*\//, "") });
      }
    }

    // Action buttons
    const actions = wrap.createDiv({ cls: "s-msg-actions" });
    const clipBtn = actions.createEl("button", { cls: "s-action-btn" });
    setIcon(clipBtn, "clipboard");
    clipBtn.title = "Copiar respuesta";
    clipBtn.onclick = () => {
      navigator.clipboard.writeText(msg.content);
      clipBtn.setText("✅");
      setTimeout(() => clipBtn.setText(""), 1200);
    };

    if (msg.meshMeta) {
      const saveBtn = actions.createEl("button", { cls: "s-action-btn" });
      setIcon(saveBtn, "save");
      saveBtn.title = "Guardar nota";
      saveBtn.onclick = () => this.plugin.createNoteWithAI();
    }
  }

  clear(): void {
    this.messages = [];
    this.threadEl.empty();
    if (this.threadId) {
      this.plugin.saveThreadMessages(this.threadId, []).catch((err: any) => { if (err) console.warn("[Messages] clear save:", err.message); });
    }
  }

  private async save(): Promise<void> {
    if (!this.threadId) return;
    try {
      await this.plugin.saveThreadMessages(this.threadId, this.messages);
    } catch (err: any) {
      console.warn("[Messages] save:", err.message);
      new Notice("⚠ Error al guardar mensajes — se perderán al recargar", 5000);
    }
  }

  async loadThreadMessages(): Promise<boolean> {
    if (!this.threadId) return false;
    try {
      const parsed = await this.plugin.loadThreadMessages(this.threadId);
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.messages = parsed;
        this.renderAll();
        return true;
      }
    } catch (err: any) {
      console.warn("[Messages] loadThreadMessages:", err.message);
    }
    return false;
  }
}
