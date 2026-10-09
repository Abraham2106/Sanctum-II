import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_MODEL, type SanctumSettings } from "../constants";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import {
  rebuildEmbedderPort,
  refreshLocalEmbeddingHealth,
  type EmbeddingHealthSnapshot,
} from "../plugin/embedding-service";
import { embeddingHealthDetail, embeddingHealthLabel } from "./settings-embedding-health";

export interface SettingsTabPlugin {
  settings: SanctumSettings;
  saveSettings(): Promise<void>;
  testEmbeddings(): Promise<void>;
  testChat(): Promise<void>;
  indexResearch(): Promise<void>;
  runOrchestrate(prompt: string): Promise<void>;
  createNoteWithAI(): Promise<void>;
  agent: { avatar: string; name: string; description: string } | null;
  geminiBalancer?: GeminiBalancer;
  rebuildEmbeddingFromSettings?: () => void;
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
      .setName("Proveedor LLM")
      .setDesc("openai: OpenCode / compatible con OpenAI. anthropic: Claude Messages API.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openai", "OpenAI-compatible (OpenCode)")
          .addOption("anthropic", "Anthropic (Claude)")
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (val) => {
            this.plugin.settings.llmProvider = val as "openai" | "anthropic";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Modelo de chat")
      .setDesc(`Vacío = ${DEFAULT_MODEL} (OpenAI-compatible). Con Anthropic, indica el id del modelo Claude.`)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_MODEL)
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (val) => {
            this.plugin.settings.llmModel = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenCode Go — API Key")
      .setDesc(`API key para el cable OpenAI-compatible (${DEFAULT_MODEL} por defecto)`)
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
      .setName("Anthropic — API Key")
      .setDesc("Clave para el cable anthropic (x-api-key)")
      .addText((text) =>
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (val) => {
            this.plugin.settings.anthropicApiKey = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Anthropic — Base URL")
      .setDesc("Por defecto https://api.anthropic.com")
      .addText((text) =>
        text
          .setPlaceholder("https://api.anthropic.com")
          .setValue(this.plugin.settings.anthropicBaseUrl)
          .onChange(async (val) => {
            this.plugin.settings.anthropicBaseUrl = val;
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

    containerEl.createEl("h3", { text: "Embeddings (RAG)" });
    containerEl.createDiv({
      text: "El chat LLM y los embeddings son independientes: un backend local offline no desactiva el chat.",
      attr: { cls: "sanctum-setting-info" },
    });

    const healthEl = containerEl.createDiv({ cls: "sanctum-setting-info" });
    const renderHealth = (snapshot: EmbeddingHealthSnapshot) => {
      healthEl.empty();
      healthEl.createDiv({ text: embeddingHealthLabel(snapshot), attr: { style: "font-weight:600" } });
      healthEl.createDiv({ text: embeddingHealthDetail(snapshot), attr: { style: "font-size:12px;margin-top:4px" } });
    };
    const balancer = this.plugin.geminiBalancer;
    if (balancer) {
      renderHealth(rebuildEmbedderPort(this.plugin.settings, balancer, null).health);
    } else {
      healthEl.setText("Estado de embeddings: configurá Gemini o el runtime local abajo.");
    }

    new Setting(containerEl)
      .setName("Backend de embeddings")
      .setDesc("Gemini por defecto. Local requiere sidecar Python en loopback (DEC-0023).")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("gemini", "Gemini")
          .addOption("sentence-transformers", "Local sentence-transformers")
          .setValue(this.plugin.settings.embeddingBackend)
          .onChange(async (val) => {
            this.plugin.settings.embeddingBackend = val as SanctumSettings["embeddingBackend"];
            this.plugin.rebuildEmbeddingFromSettings?.();
            await this.plugin.saveSettings();
            if (balancer) renderHealth(rebuildEmbedderPort(this.plugin.settings, balancer, null).health);
          })
      );

    new Setting(containerEl)
      .setName("Revisión local (40 hex)")
      .setDesc("Revisión inmutable del modelo local; vacío hasta configurar.")
      .addText((text) =>
        text
          .setPlaceholder("abcdef0123456789...")
          .setValue(this.plugin.settings.localEmbeddingRevision)
          .onChange(async (val) => {
            this.plugin.settings.localEmbeddingRevision = val.trim();
            this.plugin.rebuildEmbeddingFromSettings?.();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Puerto local")
      .setDesc("Solo 127.0.0.1 — default 8767")
      .addText((text) =>
        text
          .setPlaceholder("8767")
          .setValue(String(this.plugin.settings.localEmbeddingPort))
          .onChange(async (val) => {
            const n = Number.parseInt(val, 10);
            if (!Number.isFinite(n)) return;
            this.plugin.settings.localEmbeddingPort = n;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Token local (Bearer)")
      .setDesc("Obligatorio para el sidecar local. No se muestra en mensajes de error.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("••••••••")
          .setValue(this.plugin.settings.localEmbeddingToken)
          .onChange(async (val) => {
            this.plugin.settings.localEmbeddingToken = val;
            this.plugin.rebuildEmbeddingFromSettings?.();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Dimensiones locales")
      .setDesc("768 / 512 / 256 / 128 — debe coincidir con el índice activo.")
      .addDropdown((dropdown) => {
        for (const d of [768, 512, 256, 128]) dropdown.addOption(String(d), String(d));
        dropdown.setValue(String(this.plugin.settings.localEmbeddingDims)).onChange(async (val) => {
          this.plugin.settings.localEmbeddingDims = Number.parseInt(val, 10);
          this.plugin.rebuildEmbeddingFromSettings?.();
          await this.plugin.saveSettings();
        });
      });

    if (balancer && this.plugin.settings.embeddingBackend === "sentence-transformers") {
      new Setting(containerEl)
        .setName("Comprobar runtime local")
        .setDesc("Consulta /health en loopback (no inicia Python ni descarga pesos).")
        .addButton((btn) =>
          btn.setButtonText("Actualizar estado").onClick(async () => {
            btn.setDisabled(true);
            healthEl.setText("Comprobando runtime local…");
            try {
              const snap = await refreshLocalEmbeddingHealth(this.plugin.settings, balancer, null);
              renderHealth(snap);
            } catch {
              healthEl.setText("No se pudo comprobar el runtime local.");
            } finally {
              btn.setDisabled(false);
            }
          }),
        );
    }
  }
}
