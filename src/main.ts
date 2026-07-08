import { Notice, Plugin } from "obsidian";
import { getEnv } from "./core/env-loader";
import { GeminiBalancer } from "./embeddings/gemini-balancer";
import { OpenCodeClient } from "./llm/opencode-client";
import { loadAgentFromVault } from "./agents/agent-loader";
import { fallbackAgent, FALLBACK_SYSTEM_PROMPT } from "./agents/fallback";
import type { AgentDefinition } from "./agents/types";
import { VectorStore } from "./rag/vector-store";
import { indexResearchFolder } from "./rag/indexer";
import { NoteWriter } from "./core/note-writer";
import { Tracer } from "./observability/tracer";
import { executeTurn } from "./orchestrator/agent-turn";
import { VIEW_TYPE_SANCTUM, DEFAULT_SETTINGS } from "./constants";
import type { SanctumSettings } from "./constants";
import { SanctumChatView, type ChatViewPlugin } from "./ui/chat-view";
import { SanctumSettingTab, type SettingsTabPlugin } from "./ui/settings-tab";
import { registerCommands } from "./core/commands";
import { testEmbeddings, testChat } from "./core/tests";
import { executeWriteIntent, createNoteAction, canWriteToPath } from "./orchestrator/note-generator";
import type { NoteGenDeps } from "./orchestrator/note-generator";
import { runMeshWithCritic } from "./orchestrator/mesh";
import type { MeshResultFull } from "./orchestrator/mesh";

export default class SanctumPlugin extends Plugin implements ChatViewPlugin, SettingsTabPlugin {
  settings: SanctumSettings;
  geminiBalancer: GeminiBalancer;
  opencodeClient: OpenCodeClient;
  vectorStore: VectorStore;
  agent: AgentDefinition | null = null;
  activeFolder: string | null = null;
  noteWriter: NoteWriter;
  tracer: Tracer;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.vectorStore = new VectorStore();
    await this.vectorStore.load(this.app.vault.adapter);
    this.rebuildClients();
    await this.loadAgent();
    this.noteWriter = new NoteWriter(this.app.vault.adapter);
    this.tracer = new Tracer(this.app.vault.adapter);
    this.app.vault.adapter.write("sanctum-logs/traces/.gitkeep", "").catch(() => {});

    this.registerView(VIEW_TYPE_SANCTUM, (leaf) => new SanctumChatView(leaf, this));
    this.addRibbonIcon("bot", "Sanctum II — Chat", () => this.initLeaf());
    registerCommands(this);
    this.addSettingTab(new SanctumSettingTab(this.app, this));
  }

  async loadAgent(): Promise<void> {
    try {
      this.agent = await loadAgentFromVault(this.app.vault.adapter);
      console.log(`Sanctum: agente "${this.agent.name}" cargado`);
    } catch (err: any) {
      console.warn("Sanctum: no se pudo cargar agente_base.md:", err.message);
      this.agent = null;
    }
  }

  get systemPrompt(): string {
    return this.agent?.system_prompt || FALLBACK_SYSTEM_PROMPT;
  }

  get agentName(): string {
    return this.agent?.name || "@agente_base";
  }

  setActiveFolder(folder: string | null): void {
    this.activeFolder = folder;
    console.log("Sanctum: active folder set to", folder || "Todo /Research/");
  }

  private get pathFilter(): string[] | undefined {
    return this.activeFolder ? [`${this.activeFolder}/**`] : undefined;
  }

  private get agentOrFallback(): AgentDefinition {
    return this.agent || fallbackAgent();
  }

  private get noteGenDeps(): NoteGenDeps {
    return {
      agent: this.agentOrFallback,
      opencodeClient: this.opencodeClient,
      noteWriter: this.noteWriter,
      tracer: this.tracer,
      vaultAdapter: this.app.vault.adapter,
      writePaths: this.agent?.permissions?.write_paths || [],
    };
  }

  private parseWriteIntent(msg: string): { name: string; topic: string } | null {
    const lower = msg.toLowerCase().trim();
    let m = lower.match(/cre[áa]?\s*(?:una\s*)?nota\s*(?:llamada\s*)?["']?([\w\-\.]+)["']?\s*(?:sobre\s*|de\s*|acerca\s*de\s*)?(.+)?/i);
    if (m) return { name: m[1].replace(/\.md$/i, "") + ".md", topic: m[2]?.trim() || m[1] };
    m = lower.match(/cre[áa]?\s*(?:una\s*)?nota\s*(?:sobre\s*|de\s*|acerca\s*de\s*)?(.+)/i);
    if (m) return { name: `nota-${Date.now()}.md`, topic: m[1].trim() };
    return null;
  }

  // ---- Indexador ----

  async indexResearch(folder?: string): Promise<void> {
    if (!this.geminiBalancer.hasKeys) {
      new Notice("Necesitás GEMINI_API_KEYS para indexar");
      return;
    }
    const label = folder ? `/${folder}/` : "/Research/";
    const notice = new Notice(`Indexando ${label}... (puede tardar)`, 0);
    const traceId = this.tracer.start("indexador", "", `Indexar ${label}`);
    try {
      if (!folder) {
        this.vectorStore.clear();
      }
      const result = await indexResearchFolder(this.app.vault.adapter, this.geminiBalancer, this.vectorStore, folder);
      await this.vectorStore.save(this.app.vault.adapter);
      await this.tracer.finish(`${result.totalChunks} chunks indexados`, { path: label, notes: result.totalNotes, errors: result.errors.length });
      notice.hide();
      if (result.errors.length > 0) {
        new Notice(`Indexado ${label}: ${result.totalChunks} chunks en ${result.totalNotes} notas (${result.errors.length} errores)`);
        console.warn("Sanctum index errors:", result.errors);
      } else {
        new Notice(`Indexado ${label}: ${result.totalChunks} chunks en ${result.totalNotes} notas`);
      }
    } catch (err: any) {
      this.tracer.abort(err.message);
      notice.hide();
      new Notice(`Error al indexar ${label}: ${err.message}`);
    }
  }

  // ---- Métodos públicos para UI ----

  async testEmbeddings(): Promise<void> {
    if (!this.geminiBalancer.hasKeys) { new Notice("No hay GEMINI_API_KEYS"); return; }
    const notice = new Notice("Generando embedding...", 0);
    try {
      notice.hide();
      new Notice(await testEmbeddings(this.geminiBalancer));
    } catch (err: any) {
      notice.hide();
      new Notice(`Error: ${err.message}`);
    }
  }

  async testChat(): Promise<void> {
    if (!this.opencodeClient.configured) { new Notice("OPENCODE_GO_API_KEY no configurada"); return; }
    const notice = new Notice("Llamando a OpenCode...", 0);
    try {
      notice.hide();
      new Notice(await testChat(this.opencodeClient, this.agent));
    } catch (err: any) {
      notice.hide();
      new Notice(`Error: ${err.message}`);
    }
  }

  async runOrchestrate(prompt: string): Promise<void> {
    if (!this.opencodeClient.configured) { new Notice("OPENCODE_GO_API_KEY no configurada"); return; }
    const notice = new Notice(`@${this.agentName} está pensando...`, 0);
    const agent = this.agentOrFallback;
    const traceId = this.tracer.start(agent.id, this.systemPrompt, prompt);
    try {
      const result = await executeTurn(
        { agent, opencodeClient: this.opencodeClient, geminiBalancer: this.geminiBalancer, vectorStore: this.vectorStore, tracer: this.tracer },
        prompt,
        false,
        this.pathFilter,
      );
      await this.tracer.finish(result.content);
      notice.hide();
      new Notice(`${this.agentName} respondió (${result.usage.completion} tokens). Trace guardado.`);
      console.log(`Sanctum trace: sanctum-logs/traces/${traceId}.json`);
    } catch (err: any) {
      this.tracer.abort(err.message);
      notice.hide();
      new Notice(`Error: ${err.message}`);
    }
  }

  async sendChatMessage(userMessage: string): Promise<string> {
    if (!this.opencodeClient.configured) return "OPENCODE_GO_API_KEY no configurada.";
    const writeIntent = this.parseWriteIntent(userMessage);
    if (writeIntent) return await executeWriteIntent(this.noteGenDeps, writeIntent);

    let agent = this.agentOrFallback;
    let actualMessage = userMessage;

    // Detect @agent mention at start of message
    const mentionMatch = userMessage.trim().match(/^@([\w\-]+)(?:\s+([\s\S]*))?$/);
    if (mentionMatch) {
      const targetAgentId = mentionMatch[1];
      try {
        const loadedAgent = await loadAgentFromVault(this.app.vault.adapter, `${targetAgentId}.md`);
        agent = loadedAgent;
        actualMessage = mentionMatch[2]?.trim() || "Presentate y saludame.";
      } catch (err: any) {
        console.warn(`Sanctum: no se pudo cargar el agente mencionado @${targetAgentId}, usando agente_base.`, err.message);
      }
    }

    const traceId = this.tracer.start(agent.id, agent.system_prompt || FALLBACK_SYSTEM_PROMPT, actualMessage);
    try {
      const result = await executeTurn(
        { agent, opencodeClient: this.opencodeClient, geminiBalancer: this.geminiBalancer, vectorStore: this.vectorStore, tracer: this.tracer },
        actualMessage,
        false,
        this.pathFilter,
      );

      const appendMatch = actualMessage.toLowerCase().match(/agreg[áa]?\s*a\s*["']?([^"'\n]+)["']?/i);
      if (appendMatch) {
        const targetPath = appendMatch[1].trim();
        if (!canWriteToPath(targetPath, agent.permissions?.write_paths)) {
          return `⛔ El agente no tiene permisos para escribir en ${targetPath}.`;
        }
        const wr = await this.noteWriter.append(targetPath, `\n\n---\n\n_Agregado por IA:_\n\n${result.content}`);
        await this.tracer.finish(result.content, { append_to: targetPath });
        return `${result.content}\n\n---\n✏️ ${wr.message}`;
      }

      await this.tracer.finish(result.content);
      return result.content;
    } catch (err: any) {
      this.tracer.abort(err.message);
      return `Error: ${err.message}`;
    }
  }

  async createNoteWithAI(): Promise<void> {
    if (!this.opencodeClient.configured) { new Notice("OPENCODE_GO_API_KEY no configurada"); return; }
    const notice = new Notice("🤖 Generando contenido...", 0);
    try {
      const path = await createNoteAction(this.noteGenDeps);
      notice.hide();
      new Notice(`✏️ Nota creada: ${path}`);
    } catch (err: any) {
      notice.hide();
      new Notice(`Error: ${err.message}`);
    }
  }

  async getLatestTrace(): Promise<string> {
    try {
      const dir = "sanctum-logs/traces";
      const files = await this.app.vault.adapter.list(dir).catch(() => null);
      if (!files || files.files.length === 0) return "No hay traces todavía.";
      const traceFiles = files.files.filter((f: string) => f.endsWith(".json")).sort();
      const latest = traceFiles[traceFiles.length - 1];
      const content = await this.app.vault.adapter.read(latest);
      const parsed = JSON.parse(content);
      const ls = parsed.loop_state || {};
      const loopState = ls.loopState || ls;

      let output = `## Trace: \`${parsed.trace_id}\`\n\n`;
      output += `**Agente:** ${parsed.agent_id}  \n`;
      output += `**Duración:** ${parsed.duration_ms}ms  \n\n`;

      if (loopState.original_prompt) {
        output += `### 📝 Prompt original\n${loopState.original_prompt}\n\n`;
      }

      if (loopState.history) {
        for (const entry of loopState.history) {
          const emoji = entry.agent === "forager" ? "🔍" : entry.agent === "researcher" ? "📚" : "⚖️";
          output += `### ${emoji} ${entry.agent.charAt(0).toUpperCase() + entry.agent.slice(1)}\n`;
          if (entry.usage) {
            output += `**Tokens:** prompt ${entry.usage.prompt}, completion ${entry.usage.completion}  \n`;
          }
          if (entry.score !== undefined) {
            output += `**Score:** ${entry.score}/100  \n`;
            output += `**Veredicto:** ${entry.verdict || "N/A"}  \n`;
            if (entry.feedback && entry.feedback.length > 0) {
              output += `**Feedback:**\n${entry.feedback.map((f: string) => `- ${f}`).join("\n")}  \n`;
            }
          }
          output += `\n${entry.output.slice(0, 1500)}\n\n`;
        }
        if (ls.critic_verdict === "escalated") {
          output += `### ⚠️ Resultado: Escalado al usuario (score: ${ls.critic_score})  \n`;
        } else if (ls.critic_verdict === "accept") {
          output += `### ✅ Resultado: Aceptado (score: ${ls.critic_score}, intentos: ${ls.attempts})  \n`;
        }
      } else {
        // Legacy format (pre-Etapa 15)
        if (loopState.forager_output) {
          output += `### 🔍 Forager — Prompt reformulado\n${loopState.forager_output.slice(0, 1000)}\n\n`;
        }
        output += `### 🤖 Researcher — Output final\n${parsed.output?.slice(0, 1500)}\n\n`;
      }

      if (parsed.input?.injected_context?.length > 0) {
        output += `### 📚 Contexto RAG inyectado (${parsed.input.injected_context.length} chunks)\n`;
        for (const c of parsed.input.injected_context) {
          output += `- \`${c.from_note}\` (score: ${c.similarity_score.toFixed(3)})\n`;
        }
      }

      output += `\n---\n*Path: \`${latest}\`*`;
      return output;
    } catch (err: any) {
      return `Error al leer traces: ${err.message}`;
    }
  }

  async runMesh(userPrompt: string): Promise<MeshResultFull> {
    if (!this.opencodeClient.configured) {
      throw new Error("OPENCODE_GO_API_KEY no configurada.");
    }
    if (!this.geminiBalancer.hasKeys) {
      throw new Error("Necesitás GEMINI_API_KEYS para el mesh.");
    }

    const writeIntent = this.parseWriteIntent(userPrompt);
    let actualPrompt = userPrompt;
    if (writeIntent) {
      actualPrompt = `${userPrompt}\n\n---\n**Instrucción automática — Modo Creación de Nota:**\nEl usuario ha pedido crear una nota en su base de conocimiento. Tu respuesta final debe estar formateada como un documento Markdown completo. Es OBLIGATORIO que incluyas al final del documento entre 3 y 5 etiquetas (hashtags como \`#quantum-computing\`, \`#concept\`) que conecten semánticamente los temas tratados, para que el sistema de grafos de Obsidian pueda relacionar esta nota con el resto del vault.`;
    }

    const notice = new Notice(`🔀 Ejecutando mesh ${writeIntent ? `para crear nota "${writeIntent.name}"` : "Forager→Researcher→Critic"}...`, 0);
    try {
      const result = await runMeshWithCritic({
        userPrompt: actualPrompt,
        vaultAdapter: this.app.vault.adapter,
        geminiBalancer: this.geminiBalancer,
        vectorStore: this.vectorStore,
        opencodeClient: this.opencodeClient,
        tracer: this.tracer,
        pathFilter: this.pathFilter,
      });

      if (result.criticVerdict === "accept" && writeIntent) {
        const wr = await this.noteWriter.create(writeIntent.name, result.researcherOutput);
        if (wr.success) {
          result.createdNotePath = wr.path;
        } else {
          new Notice(`⚠️ ${wr.message}`);
        }
      }

      notice.hide();
      return result;
    } catch (err: any) {
      notice.hide();
      throw err;
    }
  }

  // ---- Lifecycle ----

  rebuildClients(): void {
    const env = getEnv();
    this.opencodeClient = new OpenCodeClient(
      this.settings.opencodeBaseUrl || env.OPENCODE_GO_BASE_URL,
      this.settings.opencodeApiKey || env.OPENCODE_GO_API_KEY,
    );
    this.geminiBalancer = new GeminiBalancer(this.settings.geminiApiKeys || env.GEMINI_API_KEYS);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.rebuildClients();
  }

  async initLeaf(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_SANCTUM)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_SANCTUM, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}
