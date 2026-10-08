import { Notice, Plugin, TFile } from "obsidian";
import { getEnv } from "./core/env-loader";
import { GeminiBalancer } from "./embeddings/gemini-balancer";
import { OpenCodeClient } from "./llm/opencode-client";
import { loadAgentFromVault } from "./agents/agent-loader";
import { fallbackAgent } from "./agents/fallback";
import type { AgentDefinition } from "./agents/types";
import { VectorStore } from "./rag/vector-store";
import { NoteWriter } from "./core/note-writer";
import { Tracer } from "./observability/tracer";
import { VIEW_TYPE_SANCTUM, DEFAULT_SETTINGS } from "./constants";
import type { SanctumSettings } from "./constants";
import { SanctumChatView, type ChatViewPlugin } from "./ui/chat-view";
import type { ChatViewHandle } from "./ui/chat-types";
import { SanctumSettingTab, type SettingsTabPlugin } from "./ui/settings-tab";
import { registerCommands } from "./core/commands";
import type { MeshResultFull } from "./orchestrator/mesh";
import { KgEdgeStore } from "./kg/kg-store";
import { recomputeAllEdges, recomputeNoteEdges } from "./kg/kg";
import { KgView, VIEW_TYPE_KG } from "./ui/kg-view";
import type { Skill } from "./skills/types";
import { listSkills, loadSkill } from "./skills/loader";
import { ProjectsView, VIEW_TYPE_PROJECTS } from "./ui/projects-view";
import { ChainView, VIEW_TYPE_CHAINS } from "./ui/chain-view";
import { ChainStore } from "./chains/store";
import { ProjectStore } from "./projects/store";
import type { Project } from "./projects/types";
import { indexProject } from "./projects/indexer";
import { ensureVaultDirectory } from "./core/vault-fs";
import { AgentAuthoringError, AgentAuthoringService } from "./agents/authoring/service";
import { SkillAuthoringMesh } from "./skills/authoring/mesh";
import type { SkillAuthoringProgress, SkillGenerationRequest } from "./skills/authoring/types";

import { AppServices } from "./app/services";
import { ChatOrchestrator, type ChatResponse } from "./app/chat-orchestrator";
import { parseWriteIntent as parseWriteIntentFromUtils } from "./utils";
import type { ConversationMessage } from "./orchestrator/conversation";
import { sendChatMessage as sendChatMessageBody, runMesh as runMeshBody } from "./plugin/turns";
import {
  setActiveProject as setActiveProjectBody,
  loadThreadMessages as loadThreadMessagesBody,
  saveThreadMessages as saveThreadMessagesBody,
  loadThreadMessagesForProject as loadThreadMessagesForProjectBody,
  loadConversationSummaryForProject as loadConversationSummaryForProjectBody,
  saveThreadMessagesForProject as saveThreadMessagesForProjectBody,
} from "./plugin/session";
import {
  indexResearch as indexResearchBody,
  testEmbeddings as testEmbeddingsBody,
  testChat as testChatBody,
  runOrchestrate as runOrchestrateBody,
  createNoteWithAI as createNoteWithAIBody,
} from "./plugin/diagnostics";


export default class SanctumPlugin extends Plugin implements ChatViewPlugin, SettingsTabPlugin {
  settings!: SanctumSettings;
  geminiBalancer!: GeminiBalancer;
  opencodeClient!: OpenCodeClient;
  vectorStore!: VectorStore;
  agent: AgentDefinition | null = null;
  activeFolder: string | null = null;
  noteWriter!: NoteWriter;
  tracer!: Tracer;
  kgEdgeStore!: KgEdgeStore;
  projectStore!: ProjectStore;
  chainStore!: ChainStore;
  services!: AppServices;
  chatOrch!: ChatOrchestrator;

  get agentName(): string { return this.agent?.name || this.services?.agent?.name || "Sanctum"; }
  get pathFilter(): string[] | undefined { return this.services?.pathFilter; }

  private vectorStores = new Map<string, VectorStore>();
  private kgEdgeStores = new Map<string, KgEdgeStore>();

  async getSkills(): Promise<Skill[]> { return listSkills(this.app.vault.adapter); }
  async setSkillContext(skillId: string | null): Promise<void> {
    this.services.skillContext = skillId ? await loadSkill(this.app.vault.adapter, skillId) : null;
    if (skillId && this.services.skillContext) new Notice(`🧠 Skill activo: ${this.services.skillContext.name}`);
    else this.services.skillContext = null;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.vectorStore = new VectorStore();
    if (!this.settings.projectsEnabled) await this.vectorStore.load(this.app.vault.adapter);
    this.rebuildClients();
    await this.loadAgent();
    this.noteWriter = new NoteWriter(this.app.vault.adapter);
    this.tracer = new Tracer(this.app.vault.adapter);
    await ensureVaultDirectory(this.app.vault.adapter, "sanctum-logs/traces");

    this.kgEdgeStore = new KgEdgeStore();
    if (!this.settings.projectsEnabled) await this.kgEdgeStore.load(this.app.vault.adapter);
    await this.rebuildKgEdges();

    this.projectStore = new ProjectStore(this.app.vault.adapter);
    this.chainStore = new ChainStore(this.app.vault.adapter);
    await ensureVaultDirectory(this.app.vault.adapter, "sanctum-chains");

    // ── Init AppServices ──
    this.services = new AppServices({
      adapter: this.app.vault.adapter,
      opencodeClient: this.opencodeClient,
      geminiBalancer: this.geminiBalancer,
      tracer: this.tracer,
      vectorStore: this.vectorStore,
      vectorStores: this.vectorStores,
      projectStore: this.projectStore,
      kgEdgeStore: this.kgEdgeStore,
      chainStore: this.chainStore,
      noteWriter: this.noteWriter,
      settings: this.settings,
      agent: this.agent,
      activeFolder: this.activeFolder,
      activeProject: null,
      activeProjectContext: null,
      activeThreadId: this.generateThreadId(),
      skillContext: null,
      getSkills: () => this.getSkills(),
      setSkillContext: (id: string | null) => this.setSkillContext(id),
    });

    // ── Orchestrators ──
    this.chatOrch = new ChatOrchestrator(this.services);

    await this.initProjects();

    // ── Register views ──
    this.registerView(VIEW_TYPE_SANCTUM, (leaf) => {
      const view = new SanctumChatView(leaf, this);
      view.setThreadId(this.services.activeThreadId);
      return view;
    });
    this.registerView(VIEW_TYPE_KG, (leaf) => new KgView(leaf, {
      edgeStore: this.kgEdgeStore,
      onSendToChat: (seed) => new Notice(`Enviando "${seed}" al chat…`),
    }));
    this.registerView(VIEW_TYPE_PROJECTS, (leaf) => new ProjectsView(leaf, { projectStore: this.projectStore, geminiBalancer: this.geminiBalancer, vaultAdapter: this.app.vault.adapter, getActiveProjectId: () => this.services.activeProject?.id || this.settings.activeProjectId, getVectorStore: (id) => this.getVectorStoreForProject(id), onSelectProject: (id) => this.setActiveProject(id), onOpenThread: async (message, threadId) => { if (threadId) this.services.activeThreadId = threadId; else this.services.activeThreadId = this.generateThreadId(); await this.initLeaf(); const chatViews = this.app.workspace.getLeavesOfType(VIEW_TYPE_SANCTUM); for (const leaf of chatViews) { const view = leaf.view as unknown as ChatViewHandle; view.setThreadId(this.services.activeThreadId); if (message) await view.postMessage(message); else await view.reloadForProject?.(this.services.activeThreadId); break; } this.refreshProjectViews(); }, loadMemory: (id) => this.projectStore.loadMemory(id), appendMemory: async (text, source) => { const pid = this.services.activeProject?.id || this.settings.activeProjectId; await this.projectStore.appendMemory(pid, { text, source: source || "manual", timestamp: Date.now() }); }, saveProject: (p) => this.projectStore.saveProject(p), getVectorCount: (id) => this.vectorStores.get(id)?.count || 0 }));
    this.registerView(VIEW_TYPE_CHAINS, (leaf) => new ChainView(leaf, {
      chainStore: this.chainStore,
      vaultAdapter: this.app.vault.adapter,
      getTurnDeps: () => ({
        agent: this.agent || fallbackAgent(),
        opencodeClient: this.opencodeClient,
        geminiBalancer: this.geminiBalancer,
        vectorStore: this.vectorStore,
        tracer: this.tracer,
        tavilyApiKey: this.settings.tavilyApiKey,
        kgOptions: this.services.kgOptions,
        edgeStore: this.kgEdgeStore,
        projectContext: this.services.activeProjectContext || undefined,
        skillContext: this.services.skillContext || undefined,
      }),
    }));
    this.addRibbonIcon("bot", "Sanctum II — Chat", () => this.initLeaf());
    this.addRibbonIcon("git-fork", "Knowledge Graph", () => this.activateKgView());
    this.addRibbonIcon("folders", "Proyectos", () => this.activateProjectsView());
    this.addRibbonIcon("git-branch", "Orquestador", () => this.activateChainsView());
    this.addCommand({ id: "open-kg", name: "Abrir Knowledge Graph", callback: () => this.activateKgView() });
    this.addCommand({ id: "open-projects", name: "Abrir Proyectos", callback: () => this.activateProjectsView() });
    this.addCommand({ id: "open-chains", name: "Abrir Orquestador de Cadenas", callback: () => this.activateChainsView() });
    this.addCommand({ id: "create-agent", name: "Crear o validar agente", callback: () => { void this.openAgentGenerator(); } });
    registerCommands(this);
    this.addSettingTab(new SanctumSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on("modify", (file) => { if (!(file instanceof TFile) || !file.path.endsWith(".md")) return; this.onNoteModified(file.path); }));
    this.registerEvent(this.app.vault.on("delete", (file) => { if (!(file instanceof TFile) || !file.path.endsWith(".md")) return; this.kgEdgeStore.delAllEdgesForNote(file.path); }));
  }

  // ── Settings ──

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.rebuildClients();
    if (this.services) this.services.settings = this.settings;
  }

  async loadAgent(): Promise<void> {
    try {
      const a = await loadAgentFromVault(this.app.vault.adapter);
      this.agent = a;
      if (this.services) this.services.agent = a;
    } catch (err: any) {
      console.warn("[Agent] fallback active — default agent not found:", err.message);
    }
  }

  rebuildClients(): void {
    const env = getEnv();
    this.opencodeClient = new OpenCodeClient(
      this.settings.opencodeBaseUrl || env.OPENCODE_GO_BASE_URL,
      this.settings.opencodeApiKey || env.OPENCODE_GO_API_KEY,
      {
        provider: this.settings.llmProvider,
        model: this.settings.llmModel || env.LLM_MODEL,
        anthropicApiKey: this.settings.anthropicApiKey || env.ANTHROPIC_API_KEY,
        anthropicBaseUrl: this.settings.anthropicBaseUrl || env.ANTHROPIC_BASE_URL,
      },
    );
    this.geminiBalancer = new GeminiBalancer(this.settings.geminiApiKeys || env.GEMINI_API_KEYS);
    if (!this.settings.tavilyApiKey) this.settings.tavilyApiKey = env.TAVILY_API_KEY;
    this.syncServices();
  }

  private syncServices(): void {
    if (!this.services) return;
    this.services.opencodeClient = this.opencodeClient;
    this.services.geminiBalancer = this.geminiBalancer;
    this.services.vectorStore = this.vectorStore;
    this.services.kgEdgeStore = this.kgEdgeStore;
    this.services.agent = this.agent;
    this.services.activeFolder = this.activeFolder;
  }

  async getLatestTrace(): Promise<string> {
    try {
      const listing = await this.app.vault.adapter.list("sanctum-logs/traces");
      const traces = (listing.files || []).filter(f => f.endsWith(".json"));
      if (traces.length === 0) return "No hay traces.";
      traces.sort().reverse();
      return await this.app.vault.adapter.read(traces[0]);
    } catch (err: any) {
      console.warn("[Trace] getLatestTrace:", err.message);
      return "Error al leer traces.";
    }
  }

  // ── Chat ──

  async sendChatMessage(userMessage: string, convMessages?: ConversationMessage[], convSummary?: string, onSkillProgress?: (progress: SkillAuthoringProgress) => void): Promise<ChatResponse | string> {
    return sendChatMessageBody(this, userMessage, convMessages, convSummary, onSkillProgress);
  }

  private async createSkillFromChat(request: SkillGenerationRequest, onProgress?: (progress: SkillAuthoringProgress) => void): Promise<string> {
    if (!request.description) {
      return request.mode === "update"
        ? "Uso: `/skill-creator --update <id> describe cómo mejorar la skill`"
        : "Uso: `/skill-creator crea una skill para diseñar apps`";
    }

    const mesh = new SkillAuthoringMesh({
      adapter: this.app.vault.adapter,
      opencodeClient: this.opencodeClient,
      geminiBalancer: this.geminiBalancer,
      vectorStore: this.services.vectorStore,
      tracer: this.tracer,
      tavilyApiKey: this.settings.tavilyApiKey,
      projectContext: this.services.activeProjectContext,
      pathFilter: this.services.pathFilter,
      onProgress,
    });
    try {
      const result = await mesh.run(request);
      if (result.status === "escalated") {
        const feedback = result.feedback.length ? result.feedback.map(item => `- ${item}`).join("\n") : "- No alcanzó el umbral de calidad.";
        return `**Skill no guardada:** el mejor borrador obtuvo ${result.score}/100 tras ${result.attempts} intentos.\n\n**Feedback:**\n${feedback}\n\n<details><summary>Ver borrador no aprobado</summary>\n\n\`\`\`\`markdown\n${result.generation.skillMarkdown}\`\`\`\`\n</details>`;
      }
      await this.refreshAgentAutocomplete();
      const action = request.mode === "update" ? "actualizada" : "creada";
      new Notice(`Skill "${result.generation.skill.name}" ${action} con ${result.score}/100.`);
      const tools = result.generation.skill.tools.length ? result.generation.skill.tools.map(tool => `\`${tool}\``).join(", ") : "ninguna";
      const ragList = result.ragSources.slice(0, 3).map(source => `[[${source.notePath.replace(/\.md$/i, "")}]]`).join(", ") || "sin coincidencias locales";
      const webList = result.webSources.slice(0, 3).map(source => `[${source.title}](${source.url})`).join(", ");
      const history = result.saved?.historyPath ? `\nHistorial anterior: ${result.saved.historyPath}` : "";
      return `**Skill ${action}:** /${result.generation.skill.id}\n\nNombre: ${result.generation.skill.name}\nTools de ejecución: ${tools}\nQuality gate: **${result.score}/100** · ${result.attempts} intento(s)\nRAG: ${result.ragSources.length} fuente(s) · ${ragList}\nWeb: ${result.webSources.length} fuente(s) · ${webList}\nArchivo: ${result.saved?.skillPath}${history}\nTrace: ${result.traceId}\n\nYa podés invocarla con /${result.generation.skill.id} en el chat.`;
    } catch (error: any) {
      const message = error instanceof AgentAuthoringError
        ? error.issues.filter(issue => issue.severity === "error").map(issue => issue.message).join(" ")
        : error?.message || "No se pudo guardar la skill.";
      new Notice(message, 7000);
      return `No se pudo crear la skill: ${message}`;
    }
  }

  private async openAgentGenerator(initialDescription = ""): Promise<string> {
    const { AgentGeneratorModal } = await import("./ui/agent-generator-modal");
    const service = new AgentAuthoringService({ llm: this.opencodeClient, adapter: this.app.vault.adapter });
    const modal = new AgentGeneratorModal(this.app, service, initialDescription);
    const result = await modal.ask();
    if (!result) return "Creación de agente cancelada.";
    try {
      const saved = await service.save(result);
      await this.refreshAgentAutocomplete();
      new Notice(`Agente "${result.agent.name}" creado.`);
      const skillLine = saved.skillPath ? `\nSkill complementaria: ${saved.skillPath}` : "";
      return `**Agente creado:** @${result.agent.id}\n\nNombre: ${result.agent.name}\nArchivo: ${saved.agentPath}${skillLine}\n\nPodés mencionarlo con @${result.agent.id} en el chat.`;
    } catch (error: any) {
      const message = error instanceof AgentAuthoringError
        ? error.issues.filter(issue => issue.severity === "error").map(issue => issue.message).join(" ")
        : error?.message || "No se pudo guardar el agente.";
      new Notice(message, 7000);
      return `No se pudo crear el agente: ${message}`;
    }
  }

  private async refreshAgentAutocomplete(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SANCTUM);
    await Promise.all(leaves.map(async leaf => {
      const view = leaf.view as unknown as ChatViewHandle;
      await view.refreshAgentAutocomplete?.();
    }));
  }

  async runMesh(userPrompt: string): Promise<MeshResultFull> {
    return runMeshBody(this, userPrompt);
  }

  // ── Project management ──

  private async ensureProjectDirectories(projectId: string): Promise<void> {
    await Promise.all([
      ensureVaultDirectory(this.app.vault.adapter, "sanctum-projects"),
      ensureVaultDirectory(this.app.vault.adapter, `sanctum-memory/${projectId}`),
      ensureVaultDirectory(this.app.vault.adapter, `sanctum-logs/threads/${projectId}`),
      ensureVaultDirectory(this.app.vault.adapter, `sanctum-logs/index/${projectId}`),
      ensureVaultDirectory(this.app.vault.adapter, `Projects/${projectId}`),
    ]);
  }

  private async initProjects(): Promise<void> {
    if (!this.settings.projectsEnabled) return;
    await ensureVaultDirectory(this.app.vault.adapter, "sanctum-projects");
    const exists = await this.projectStore.projectExists(this.settings.activeProjectId).catch(() => false);
    if (!exists) {
      await this.projectStore.createProject(this.settings.activeProjectId, this.settings.activeProjectId);
    }
    // Migrate old project files: ensure write_paths includes Projects/{pid}/
    const stored = await this.projectStore.loadProject(this.settings.activeProjectId).catch(() => null);
    if (stored) {
      const projPath = `/Projects/${this.settings.activeProjectId}/`;
      let changed = false;
      if (!stored.read_paths.includes(projPath)) { stored.read_paths.push(projPath); changed = true; }
      if (!stored.write_paths.includes(projPath)) { stored.write_paths.push(projPath); changed = true; }
      if (!stored.outputPath) { stored.outputPath = `Projects/${this.settings.activeProjectId}`; changed = true; }
      if (changed) await this.projectStore.saveProject(stored);
    }
    await this.setActiveProject(this.settings.activeProjectId, false);
  }

  async setActiveProject(projectId: string, newThread: boolean = true): Promise<void> {
    return setActiveProjectBody(this, projectId, newThread);
  }

  private getVectorStoreForProject(projectId: string): { store: VectorStore; load: () => Promise<void>; save: () => Promise<void> } {
    let store = this.vectorStores.get(projectId);
    if (!store) { store = new VectorStore(`sanctum-logs/index/${projectId}/vector-store.jsonl`); this.vectorStores.set(projectId, store); }
    return { store, load: async () => { await store!.load(this.app.vault.adapter); }, save: async () => { await store!.save(this.app.vault.adapter); } };
  }

  private getKgEdgeStoreForProject(projectId: string): { store: KgEdgeStore; load: () => Promise<void>; save: () => Promise<void> } {
    let store = this.kgEdgeStores.get(projectId);
    if (!store) {
      store = new KgEdgeStore(`sanctum-logs/index/${projectId}/kg-edges.jsonl`);
      this.kgEdgeStores.set(projectId, store);
    }
    const storePath = `sanctum-logs/index/${projectId}/kg-edges.jsonl`;
    return {
      store,
      load: async () => {
        const targetExists = await this.app.vault.adapter.exists(storePath).catch(() => false);
        await store!.load(this.app.vault.adapter);
        // One-time compatibility migration for vaults created before per-project KG storage.
        if (!targetExists && projectId === this.settings.activeProjectId) {
          const legacyPath = "sanctum-logs/kg-edges.jsonl";
          if (await this.app.vault.adapter.exists(legacyPath).catch(() => false)) {
            const legacy = new KgEdgeStore(legacyPath);
            await legacy.load(this.app.vault.adapter);
            for (const edge of legacy.getAllEdges()) store!.addEdge(edge);
            await store!.save(this.app.vault.adapter);
          }
        }
      },
      save: async () => { await store!.save(this.app.vault.adapter); },
    };
  }

  // ── KG management ──

  private async rebuildKgEdges(): Promise<void> {
    if (!this.settings.kgEnabled || this.vectorStore.count === 0) return;
    recomputeAllEdges(this.vectorStore, this.kgEdgeStore, { getResolvedLinks: () => this.app.metadataCache.resolvedLinks }, {
      enabled: this.settings.kgEnabled, minSimilarity: this.settings.kgMinSimilarity, hops: this.settings.kgHops, maxNeighborsPerHop: 3,
      useExplicit: this.settings.kgUseExplicit, reinforceBoost: this.settings.kgReinforceBoost,
    });
    await this.kgEdgeStore.save(this.app.vault.adapter);
  }

  private onNoteModified(notePath: string): void {
    if (!this.settings.kgEnabled || this.vectorStore.count === 0) return;
    recomputeNoteEdges(notePath, this.vectorStore, this.kgEdgeStore, { getResolvedLinks: () => this.app.metadataCache.resolvedLinks }, {
      enabled: this.settings.kgEnabled, minSimilarity: this.settings.kgMinSimilarity, hops: this.settings.kgHops, maxNeighborsPerHop: 3,
      useExplicit: this.settings.kgUseExplicit, reinforceBoost: this.settings.kgReinforceBoost,
    });
    this.kgEdgeStore.save(this.app.vault.adapter).catch((err: any) => { if (err) console.warn("[KG] onNoteModified save:", err.message); });
  }

  // ── Threads ──

  private generateThreadId(): string { return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

  getActiveThreadId(): string { return this.services.activeThreadId; }
  getActiveProjectId(): string | null { return this.services.activeProject?.id || null; }
  getActiveProjectName(): string { return this.services.activeProject?.name || this.settings.activeProjectId || "default"; }
  getActiveProjectIcon(): string { return this.services.activeProject?.icon || "◈"; }

  async loadThreadMessages(threadId: string): Promise<any[]> {
    return loadThreadMessagesBody(this, threadId);
  }

  async saveThreadMessages(threadId: string, messages: any[]): Promise<void> {
    return saveThreadMessagesBody(this, threadId, messages);
  }

  async loadThreadMessagesForProject(projectId: string, threadId: string): Promise<any[]> {
    return loadThreadMessagesForProjectBody(this, projectId, threadId);
  }

  async loadConversationSummaryForProject(projectId: string, threadId: string): Promise<string | undefined> {
    return loadConversationSummaryForProjectBody(this, projectId, threadId);
  }

  async saveThreadMessagesForProject(projectId: string, threadId: string, messages: any[]): Promise<void> {
    return saveThreadMessagesForProjectBody(this, projectId, threadId, messages);
  }

  // ── Other legacy methods ──

  private async runProjectIndex(project: Project, folder?: string): Promise<Awaited<ReturnType<typeof indexProject>>> {
    return indexProject(this.app.vault.adapter, this.geminiBalancer, project, this.vectorStore, {
      paths: folder ? [folder] : undefined,
    });
  }

  async indexResearch(folder?: string): Promise<void> {
    return indexResearchBody(this, folder);
  }

  parseWriteIntent(text: string): { name?: string; topic: string } | null {
    return parseWriteIntentFromUtils(text);
  }

  // ── Diagnostics and actions (required by ChatViewPlugin / SettingsTabPlugin) ──

  setActiveFolder(folder: string | null): void {
    this.activeFolder = folder;
    if (this.services) this.services.activeFolder = folder;
  }

  async testEmbeddings(): Promise<void> {
    return testEmbeddingsBody(this);
  }

  async testChat(): Promise<void> {
    return testChatBody(this);
  }

  async runOrchestrate(prompt: string): Promise<void> {
    return runOrchestrateBody(this, prompt);
  }

  async createNoteWithAI(): Promise<void> {
    return createNoteWithAIBody(this);
  }

  // ── View activation ──

  private async activateView(viewType: string): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) throw new Error(`No hay un leaf disponible para abrir ${viewType}`);
      leaf = rightLeaf;
      await leaf.setViewState({ type: viewType, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async initLeaf(): Promise<void> { return this.activateView(VIEW_TYPE_SANCTUM); }
  async activateKgView(): Promise<void> { return this.activateView(VIEW_TYPE_KG); }
  async activateProjectsView(): Promise<void> { return this.activateView(VIEW_TYPE_PROJECTS); }
  async activateChainsView(): Promise<void> { return this.activateView(VIEW_TYPE_CHAINS); }

  private refreshChatViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SANCTUM);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as ChatViewHandle;
      if (view?.reloadForProject) view.reloadForProject(this.services.activeThreadId);
    }
  }

  private refreshKgViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_KG);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as { setEdgeStore?: (store: KgEdgeStore) => void };
      view?.setEdgeStore?.(this.kgEdgeStore);
    }
  }

  private refreshProjectViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PROJECTS);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as { refresh?: () => void };
      view.refresh?.();
    }
  }
}
