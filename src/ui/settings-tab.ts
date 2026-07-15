import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_MODEL, type SanctumSettings } from "../constants";

export interface SettingsTabPlugin {
  settings: SanctumSettings;
  saveSettings(): Promise<void>;
  testEmbeddings(): Promise<void>;
  testChat(): Promise<void>;
  indexResearch(): Promise<void>;
  runOrchestrate(prompt: string): Promise<void>;
  createNoteWithAI(): Promise<void>;
  agent: { avatar: string; name: string; description: string } | null;
}

export class SanctumSettingTab extends PluginSettingTab {
  plugin: SettingsTabPlugin;

  constructor(app: App, plugin: SettingsTabPlugin) {
    super(app, plugin as any);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Sanctum II — Configuración" });

    const actionRow = containerEl.createDiv();
    actionRow.style.cssText = "display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap";

    const makeBtn = (text: string, onClick: () => void | Promise<void>) => {
      const btn = actionRow.createEl("button", { text });
      btn.onclick = async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        try { await onClick(); } finally { btn.disabled = false; }
      };
    };
    makeBtn("🧪 Embeddings", () => this.plugin.testEmbeddings());
    makeBtn("💬 Chat test", () => this.plugin.testChat());
    makeBtn("📚 Indexar /Research/", () => this.plugin.indexResearch());
    makeBtn("🔍 RAG query", () => this.plugin.runOrchestrate("¿Qué dice /Research/?"));
    makeBtn("✏️ Crear nota con IA", () => this.plugin.createNoteWithAI());
    makeBtn("⚙️ Orquestar", () => this.plugin.runOrchestrate("Decime qué contiene /Research/ según tu conocimiento."));

    if (this.plugin.agent) {
      const a = this.plugin.agent;
      containerEl.createDiv({ text: `${a.avatar} ${a.name} — ${a.description}`, cls: "sanctum-setting-info" });
    }

    new Setting(containerEl)
      .setName("OpenCode Go — API Key")
      .setDesc(`API key de OpenCode para ${DEFAULT_MODEL}`)
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.opencodeApiKey)
          .onChange(async (val) => {
            this.plugin.settings.opencodeApiKey = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenCode Go — Base URL")
      .setDesc("URL base de la API de OpenCode")
      .addText((text) =>
        text
          .setPlaceholder("https://api.opencode.ai")
          .setValue(this.plugin.settings.opencodeBaseUrl)
          .onChange(async (val) => {
            this.plugin.settings.opencodeBaseUrl = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gemini API Keys")
      .setDesc("Keys de Gemini separadas por coma (gemini-embedding-2 → gemini-embedding-001)")
      .addTextArea((text) =>
        text
          .setPlaceholder("AIza...,AIza...,AIza...")
          .setValue(this.plugin.settings.geminiApiKeys)
          .onChange(async (val) => {
            this.plugin.settings.geminiApiKeys = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tavily API Key")
      .setDesc("API key de Tavily para búsqueda web en agentes con tool web_search")
      .addText((text) =>
        text
          .setPlaceholder("tvly-...")
          .setValue(this.plugin.settings.tavilyApiKey)
          .onChange(async (val) => {
            this.plugin.settings.tavilyApiKey = val;
            await this.plugin.saveSettings();
          })
      );
  }
}
