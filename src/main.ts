import { Notice, Plugin, TFile } from "obsidian";
import { getEnv } from "./core/env-loader";
import { GeminiBalancer } from "./embeddings/gemini-balancer";
import { OpenCodeClient } from "./llm/opencode-client";
import { loadAgentFromVault } from "./agents/agent-loader";
import type { AgentDefinition } from "./agents/types";
import { VectorStore } from "./rag/vector-store";
import { NoteWriter } from "./core/note-writer";
import { Tracer } from "./observability/tracer";
import { VIEW_TYPE_SANCTUM, DEFAULT_SETTINGS } from "./constants";
import type { SanctumSettings } from "./constants";
import type { ChatViewPlugin } from "./ui/chat-view";
import type { ChatViewHandle } from "./ui/chat-types";
import type { SettingsTabPlugin } from "./ui/settings-tab";
import type { MeshResultFull } from "./orchestrator/mesh";
import { KgEdgeStore } from "./kg/kg-store";
import { VIEW_TYPE_KG } from "./ui/kg-view";
import type { Skill } from "./skills/types";
import { listSkills, loadSkill } from "./skills/loader";
import { VIEW_TYPE_PROJECTS } from "./ui/projects-view";
import { VIEW_TYPE_CHAINS } from "./ui/chain-view";
import { ChainStore } from "./chains/store";
import { ProjectStore } from "./projects/store";
import { ensureVaultDirectory } from "./core/vault-fs";
import { parseSkillCreatorCommand } from "./skills/authoring/command";
import type { SkillAuthoringProgress } from "./skills/authoring/types";
import { AppServices } from "./app/services";
import { ChatOrchestrator, type ChatResponse } from "./app/chat-orchestrator";
import { parseWriteIntent as parseWriteIntentFromUtils } from "./utils";
import type { ConversationMessage } from "./orchestrator/conversation";
import type { PluginHost } from "./plugin/plugin-host";
import { PluginSession } from "./plugin/session";
import { PluginDiagnostics } from "./plugin/diagnostics";
import { PluginTurns } from "./plugin/turns";
import { createSkillFromChat, openAgentGenerator } from "./plugin/chat-extras";
import { registerPluginViews } from "./plugin/register-views";

export default class SanctumPlugin extends Plugin implements ChatViewPlugin, SettingsTabPlugin, PluginHost {
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

  private session!: PluginSession;
  private diagnostics!: PluginDiagnostics;
  private turns!: PluginTurns;

  readonly vectorStores = new Map<string, VectorStore>();
  readonly kgEdgeStores = new Map<string, KgEdgeStore>();

  get adapter() {
    return this.app.vault.adapter;
  }

  notice = (message: string, durationMs?: number) => {
    new Notice(message, durationMs ?? 4000);
  };

  get agentName(): string {
    return this.agent?.name || this.services?.agent?.name || "Sanctum";
  }

  get pathFilter(): string[] | undefined {
    return this.services?.pathFilter;
  }

  async getSkills(): Promise<Skill[]> {
    return listSkills(this.app.vault.adapter);
  }

  async setSkillContext(skillId: string | null): Promise<void> {
    this.services.skillContext = skillId ? await loadSkill(this.app.vault.adapter, skillId) : null;
    if (skillId && this.services.skillContext) {
      this.notice(`🧠 Skill activo: ${this.services.skillContext.name}`);
    } else {
      this.services.skillContext = null;
    }
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.vectorStore = new VectorStore();
    if (!this.settings.projectsEnabled) {
      await this.vectorStore.load(this.app.vault.adapter);
    }
    this.rebuildClients();
    await this.loadAgent();
    this.noteWriter = new NoteWriter(this.app.vault.adapter);
    this.tracer = new Tracer(this.app.vault.adapter);
    await ensureVaultDirectory(this.app.vault.adapter, "sanctum-logs/traces");

    this.kgEdgeStore = new KgEdgeStore();
    if (!this.settings.projectsEnabled) {
      await this.kgEdgeStore.load(this.app.vault.adapter);
    }

    this.projectStore = new ProjectStore(this.app.vault.adapter);
    this.chainStore = new ChainStore(this.app.vault.adapter);
    await ensureVaultDirectory(this.app.vault.adapter, "sanctum-chains");

    const env = getEnv();
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
      setSkillContext: (id) => this.setSkillContext(id),
      globalChat: { provider: this.settings.llmProvider, model: this.settings.llmModel || env.LLM_MODEL },
    });

    this.session = new PluginSession(this);
    this.diagnostics = new PluginDiagnostics(this, this.session);
    this.turns = new PluginTurns(this);
    this.chatOrch = new ChatOrchestrator(this.services);

    await this.session.initProjects();
    registerPluginViews(this, this.session);
    this.registerVaultIndexHooks();
  }

  private registerVaultIndexHooks(): void {
    const onMd = () => {
      this.session.indexService.onVaultNoteEvent(this.services.activeProject?.id);
    };
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.path.endsWith(".md")) onMd();
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.path.endsWith(".md")) onMd();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;
      this.kgEdgeStore.delAllEdgesForNote(file.path);
      onMd();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      if (oldPath.endsWith(".md")) {
        this.kgEdgeStore.delAllEdgesForNote(oldPath);
        onMd();
      }
      if (file.path.endsWith(".md")) onMd();
    }));
  }

  async openThreadFromProjects(message: string | undefined, threadId: string | undefined): Promise<void> {
    if (threadId) this.services.activeThreadId = threadId;
    else this.services.activeThreadId = this.generateThreadId();
    await this.initLeaf();
    const chatViews = this.app.workspace.getLeavesOfType(VIEW_TYPE_SANCTUM);
    for (const leaf of chatViews) {
      const view = leaf.view as unknown as ChatViewHandle;
      view.setThreadId(this.services.activeThreadId);
      if (message) await view.postMessage(message);
      else await view.reloadForProject?.(this.services.activeThreadId);
      break;
    }
    this.refreshProjectViews();
  }

  openAgentGeneratorPublic(): Promise<string> {
    return openAgentGenerator(this);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.rebuildClients();
    if (this.services) {
      this.services.settings = this.settings;
      this.services.rebuildEmbeddingFromSettings();
    }
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

  syncServices(): void {
    if (!this.services) return;
    this.services.opencodeClient = this.opencodeClient;
    this.services.geminiBalancer = this.geminiBalancer;
    this.services.vectorStore = this.vectorStore;
    this.services.kgEdgeStore = this.kgEdgeStore;
    this.services.agent = this.agent;
    this.services.activeFolder = this.activeFolder;
    this.services.rebuildEmbeddingFromSettings();
  }

  async sendChatMessage(
    userMessage: string,
    convMessages?: ConversationMessage[],
    convSummary?: string,
    onSkillProgress?: (progress: SkillAuthoringProgress) => void,
  ): Promise<ChatResponse | string> {
    const skillRequest = parseSkillCreatorCommand(userMessage);
    if (skillRequest) return createSkillFromChat(this, skillRequest, onSkillProgress);
    const genMatch = userMessage.trim().match(/^@(?:agent-creator|agent-generator)(?:\s+([\s\S]*))?$/i);
    if (genMatch) return openAgentGenerator(this, genMatch[1]?.trim() || "");
    return this.chatOrch.handleMessage(userMessage, convMessages, convSummary);
  }

  cancelChatRequest(): void {
    this.chatOrch.cancelInFlightChat();
  }

  cancelMeshRequest(): void {
    this.turns.cancelMesh();
  }

  async runMesh(userPrompt: string): Promise<MeshResultFull> {
    return this.turns.runMesh(userPrompt);
  }

  async setActiveProject(projectId: string, newThread: boolean = true): Promise<void> {
    return this.session.setActiveProject(projectId, newThread);
  }

  generateThreadId(): string {
    return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  getActiveThreadId(): string {
    return this.session.getActiveThreadId();
  }

  getActiveProjectId(): string | null {
    return this.session.getActiveProjectId();
  }

  getActiveProjectName(): string {
    return this.session.getActiveProjectName();
  }

  getActiveProjectIcon(): string {
    return this.session.getActiveProjectIcon();
  }

  loadThreadMessages(threadId: string): Promise<any[]> {
    return this.session.loadThreadMessages(threadId);
  }

  saveThreadMessages(threadId: string, messages: any[]): Promise<void> {
    return this.session.saveThreadMessages(threadId, messages);
  }

  loadThreadMessagesForProject(projectId: string, threadId: string): Promise<any[]> {
    return this.session.loadThreadMessagesForProject(projectId, threadId);
  }

  loadConversationSummaryForProject(projectId: string, threadId: string): Promise<string | undefined> {
    return this.session.loadConversationSummaryForProject(projectId, threadId);
  }

  saveThreadMessagesForProject(projectId: string, threadId: string, messages: any[]): Promise<void> {
    return this.session.saveThreadMessagesForProject(projectId, threadId, messages);
  }

  parseWriteIntent(text: string): { name?: string; topic: string } | null {
    return parseWriteIntentFromUtils(text);
  }

  setActiveFolder(folder: string | null): void {
    this.activeFolder = folder;
    if (this.services) this.services.activeFolder = folder;
  }

  testEmbeddings(): Promise<void> {
    return this.diagnostics.testEmbeddings();
  }

  testChat(): Promise<void> {
    return this.diagnostics.testChat();
  }

  runOrchestrate(prompt: string): Promise<void> {
    return this.diagnostics.runOrchestrate(prompt);
  }

  createNoteWithAI(): Promise<void> {
    return this.diagnostics.createNoteWithAI();
  }

  getLatestTrace(): Promise<string> {
    return this.diagnostics.getLatestTrace();
  }

  indexResearch(folder?: string): Promise<void> {
    return this.diagnostics.indexResearch(folder);
  }

  refreshChatViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SANCTUM);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as ChatViewHandle;
      view?.reloadForProject?.(this.services.activeThreadId);
    }
  }

  refreshKgViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_KG);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as { setEdgeStore?: (store: KgEdgeStore) => void };
      view?.setEdgeStore?.(this.kgEdgeStore);
    }
  }

  refreshProjectViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PROJECTS);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as { refresh?: () => void };
      view.refresh?.();
    }
  }

  async initLeaf(): Promise<void> {
    return this.activateView(VIEW_TYPE_SANCTUM);
  }

  async activateKgView(): Promise<void> {
    return this.activateView(VIEW_TYPE_KG);
  }

  async activateProjectsView(): Promise<void> {
    return this.activateView(VIEW_TYPE_PROJECTS);
  }

  async activateChainsView(): Promise<void> {
    return this.activateView(VIEW_TYPE_CHAINS);
  }

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
}
