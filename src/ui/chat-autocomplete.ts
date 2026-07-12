import { setIcon } from "obsidian";
import type { ChatViewPlugin, RailAgent } from "./chat-types";
import { renderAvatar } from "./chat-types";
import { isInternalPath } from "../utils";

interface Suggestion {
  type: "agent" | "note" | "skill";
  label: string;
  value: string;
  detail?: string;
  avatar?: string;
}

export class ChatAutocomplete {
  private dropdownEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private filteredOptions: Suggestion[] = [];
  private highlightedIndex = 0;
  private activeQuery: { startIdx: number; endIdx: number; text: string; trigger: "@" | "/" } | null = null;
  private availableAgents: RailAgent[] = [];
  private skillsCache: { id: string; name: string; description: string; tools: string[] }[] = [];
  private chainsCache: { id: string; name: string }[] = [];
  private plugin: ChatViewPlugin;
  private getApp: () => any;
  private onSkillSelect: ((id: string) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private onSelectCallback: (() => void) | null = null;

  constructor(plugin: ChatViewPlugin, getApp: () => any) {
    this.plugin = plugin;
    this.getApp = getApp;
  }

  setOnSelect(cb: () => void): void { this.onSelectCallback = cb; }

  init(inputEl: HTMLInputElement, dropdownEl: HTMLElement, onSkillSelect?: (id: string, name: string) => void): void {
    this.inputEl = inputEl;
    this.dropdownEl = dropdownEl;
    this.onSkillSelect = onSkillSelect;

    inputEl.addEventListener("input", () => this.handleInput());
    inputEl.addEventListener("keyup", (e) => { if (e.key === "@") this.handleInput(); });
  }

  setAgents(agents: RailAgent[]): void { this.availableAgents = agents; }
  setSkills(skills: { id: string; name: string; description: string; tools: string[] }[]): void { this.skillsCache = skills; }
  setChains(chains: { id: string; name: string }[]): void { this.chainsCache = chains; }

  async loadData(): Promise<void> {
    // Agents
    const agents: RailAgent[] = [];
    try {
      const files = await this.getApp().vault.adapter.list("sanctum-agents");
      const mdFiles = files.files.filter((f: string) => f.endsWith(".md"));
      for (const path of mdFiles) {
        try {
          const content = await this.getApp().vault.adapter.read(path);
          const parts = content.split("---");
          if (parts.length >= 3) {
            const fm = parts[1];
            const id = fm.match(/^id:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
            if (!id) continue;
            const internal = fm.match(/^internal:\s*(true|false)$/m)?.[1] === "true";
            if (internal) continue;
            const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || id;
            const avatar = fm.match(/^avatar:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "🤖";
            const model = fm.match(/^model:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
            agents.push({ id, name, avatar, model });
          }
        } catch {}
      }
    } catch {}
    this.availableAgents = agents;

    // Skills
    this.skillsCache = [];
    try {
      const exists = await this.getApp().vault.adapter.exists("sanctum-skills").catch(() => false);
      if (exists) {
        const listing = await this.getApp().vault.adapter.list("sanctum-skills");
        for (const f of listing.files.filter((f: string) => f.endsWith(".md"))) {
          try {
            const content = await this.getApp().vault.adapter.read(f);
            const parts = content.split("---");
            if (parts.length >= 3) {
              const fm = parts[1];
              const id = fm.match(/^id:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
              const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || id;
              const desc = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
              const toolsStr = fm.match(/^tools:\s*\[(.+)\]/)?.[1] || "";
              const tools = toolsStr.split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
              if (id) this.skillsCache.push({ id, name, description: desc, tools });
            }
          } catch {}
        }
      }
    } catch {}

    // Chains
    this.chainsCache = [];
    try {
      const exists = await this.getApp().vault.adapter.exists("sanctum-chains").catch(() => false);
      if (exists) {
        const listing = await this.getApp().vault.adapter.list("sanctum-chains");
        for (const f of listing.files.filter((x: string) => x.endsWith(".json"))) {
          try {
            const id = f.replace(/^.*[\\/]/, "").replace(".json", "");
            const raw = await this.getApp().vault.adapter.read(f);
            const c = JSON.parse(raw);
            this.chainsCache.push({ id, name: c.name || id });
          } catch {}
        }
      }
    } catch {}
  }

  private getAutocompleteQuery(): { startIdx: number; endIdx: number; text: string; trigger: "@" | "/" } | null {
    const cursorPos = this.inputEl.selectionStart ?? 0;
    const val = this.inputEl.value;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (val[i] === "@") {
        if (i === 0 || val[i - 1] === " ") {
          const text = val.slice(i + 1, cursorPos);
          if (text.includes(" ")) return null;
          return { startIdx: i, endIdx: cursorPos, text, trigger: "@" };
        }
        break;
      }
      if (val[i] === "/") {
        if (i === 0 || val[i - 1] === " ") {
          const text = val.slice(i + 1, cursorPos);
          if (text.includes(" ")) return null;
          return { startIdx: i, endIdx: cursorPos, text, trigger: "/" };
        }
        break;
      }
      if (val[i] === " ") break;
    }
    return null;
  }

  private handleInput(): void {
    try {
      const query = this.getAutocompleteQuery();
      this.activeQuery = query;
      if (!query) { this.close(); return; }

      const q = query.text.toLowerCase();

      if (query.trigger === "/") {
        this.filteredOptions = this.skillsCache
          .filter(s => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
          .map(s => ({ type: "skill" as const, label: s.name, value: s.id, detail: `/${s.id} — ${s.description.slice(0, 40)}`, avatar: "zap" }));
        this.highlightedIndex = 0;
        if (!this.filteredOptions.length) { this.close(); return; }
        this.render();
        return;
      }

      const agents = this.availableAgents
        .filter(a => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
        .map(a => ({ type: "agent" as const, label: a.name, value: a.id, detail: `@${a.id}`, avatar: a.avatar }));

      let notes: Suggestion[] = [];
      try {
        const mdFiles = this.getApp().vault.getMarkdownFiles();
        for (const file of mdFiles) {
          if (isInternalPath(file.path)) continue;
          if (file.basename.toLowerCase().includes(q) || file.path.toLowerCase().includes(q)) {
            notes.push({ type: "note" as const, label: file.basename, value: `[[${file.path}]]`, detail: file.path, avatar: "file-text" });
            if (notes.length >= 10) break;
          }
        }
      } catch {}

      const chains = this.chainsCache
        .filter(c => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
        .map(c => ({ type: "agent" as const, label: c.name, value: c.id, detail: `⛓️ @${c.id}`, avatar: "git-branch" }));
      if (chains.length > 5) chains.length = 5;

      this.filteredOptions = [...chains, ...agents, ...notes];
      this.highlightedIndex = 0;
      if (!this.filteredOptions.length) { this.close(); return; }
      this.render();
    } catch {}
  }

  private render(): void {
    this.dropdownEl.empty();
    this.dropdownEl.addClass("is-visible");

    const skillOpts = this.filteredOptions.filter(o => o.type === "skill");
    const agentOpts = this.filteredOptions.filter(o => o.type === "agent");
    const noteOpts = this.filteredOptions.filter(o => o.type === "note");

    let globalIndex = 0;
    const renderGroup = (label: string, opts: Suggestion[]) => {
      if (!opts.length) return;
      this.dropdownEl.createDiv({ cls: "s-autocomplete-group-label", text: label });
      for (const opt of opts) {
        const item = this.dropdownEl.createDiv({ cls: "s-autocomplete-item" });
        const idx = globalIndex++;
        if (idx === this.highlightedIndex) item.addClass("is-highlighted");
        const acAvatar = item.createSpan({ cls: "ac-avatar" });
        renderAvatar(acAvatar, opt.avatar || "bot", opt.value, setIcon);
        item.createSpan({ cls: "ac-label", text: opt.label });
        if (opt.detail) item.createSpan({ cls: "ac-detail", text: opt.detail });
        item.onclick = () => this.select(idx);
        item.onmouseenter = () => {
          this.dropdownEl.querySelectorAll(".s-autocomplete-item").forEach(el => el.removeClass("is-highlighted"));
          this.highlightedIndex = idx;
          item.addClass("is-highlighted");
        };
      }
    };
    renderGroup("Skills", skillOpts);
    renderGroup("Agentes", agentOpts);
    renderGroup("Notas", noteOpts);
  }

  private select(index: number): void {
    this.onSelectCallback?.();
    const opt = this.filteredOptions[index];
    if (!opt || !this.activeQuery) return;
    const val = this.inputEl.value;

    if (opt.type === "skill") {
      this.inputEl.value = val.slice(0, this.activeQuery.startIdx) + val.slice(this.activeQuery.endIdx);
      this.inputEl.focus();
      this.close();
      if (this.onSkillSelect) this.onSkillSelect(opt.value, opt.label);
      return;
    }

    const insertText = opt.type === "agent" ? `@${opt.value} ` : `${opt.value} `;
    this.inputEl.value = val.slice(0, this.activeQuery.startIdx) + insertText + val.slice(this.activeQuery.endIdx);
    const newPos = this.activeQuery.startIdx + insertText.length;
    this.inputEl.selectionStart = newPos;
    this.inputEl.selectionEnd = newPos;
    this.inputEl.focus();
    this.close();
  }

  close(): void {
    this.dropdownEl.removeClass("is-visible");
    this.activeQuery = null;
    this.filteredOptions = [];
    this.highlightedIndex = 0;
    this.closeCallback?.();
  }

  handleKeyDown(e: KeyboardEvent): void {
    const isVisible = this.dropdownEl.classList.contains("is-visible");
    if (isVisible && this.filteredOptions.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); this.highlightedIndex = (this.highlightedIndex + 1) % this.filteredOptions.length; this.render(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); this.highlightedIndex = (this.highlightedIndex - 1 + this.filteredOptions.length) % this.filteredOptions.length; this.render(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); this.select(this.highlightedIndex); return; }
      if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
    }
  }
}
