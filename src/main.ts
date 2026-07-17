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
import { testEmbeddings as testEmbeddingsFn, testChat as testChatFn } from "./core/tests";
import { createNoteAction, writeNoteAtPath } from "./orchestrator/note-generator";
import { runMeshWithCritic } from "./orchestrator/mesh";
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
import { buildProjectContext } from "./projects/context";
import { indexProject } from "./projects/indexer";
import { IncrementalIndexCoordinator, type IndexCoordinatorStatus } from "./projects/index-coordinator";
import { ensureVaultDirectory } from "./core/vault-fs";
import { AgentAuthoringError, AgentAuthoringService } from "./agents/authoring/service";
import { SkillAuthoringMesh } from "./skills/authoring/mesh";
import { parseSkillCreatorCommand } from "./skills/authoring/command";
import type { SkillAuthoringProgress, SkillGenerationRequest } from "./skills/authoring/types";

import { executeTurn } from "./orchestrator/agent-turn";
import { AppServices } from "./app/services";
import { ChatOrchestrator, type ChatResponse } from "./app/chat-orchestrator";
import { parseWriteIntent as parseWriteIntentFromUtils } from "./utils";
import type { ConversationMessage } from "./orchestrator/conversation";


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
  private indexCoordinator?: IncrementalIndexCoordinator;
  private autoIndexStatus = "inactivo";

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

    this.indexCoordinator = new IncrementalIndexCoordinator({
      adapter: this.app.vault.adapter,
      projectStore: this.projectStore,
      getVectorStore: projectId => this.getVectorStoreForProject(projectId).store,
      getEmbeddingProvider: () => this.geminiBalancer,
      canEmbed: () => this.geminiBalancer.canEmbed,
      debounceMs: 1500,
      onStatus: status => this.onAutoIndexStatus(status),
      onIndexed: async project => {
        if (project.id !== this.services.activeProject?.id) return;
        await this.rebuildKgEdges();
        this.refreshProjectViews();
        this.refreshChatViews();
      },
    });

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

    this.registerEvent(this.app.vault.on("create", file => {
      if (!(file instanceof TFile) || !file.path.endsWith(".md") || !this.settings.projectAutoIndex) return;
      void this.indexCoordinator?.queueChange({ type: "upsert", path: file.path });
    }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;
      this.onNoteModified(file.path);
      if (this.settings.projectAutoIndex) void this.indexCoordinator?.queueChange({ type: "upsert", path: file.path });
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;
      this.kgEdgeStore.delAllEdgesForNote(file.path);
      if (this.settings.projectAutoIndex) void this.indexCoordinator?.queueChange({ type: "delete", path: file.path });
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || (!file.path.endsWith(".md") && !oldPath.endsWith(".md")) || !this.settings.projectAutoIndex) return;
      void this.indexCoordinator?.queueChange({ type: "rename", oldPath, path: file.path });
    }));
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.projectAutoIndex) void this.indexCoordinator?.reconcileAll().catch(error => console.warn("[AutoIndex] startup:", error));
    });
  }

  onunload(): void {
    this.indexCoordinator?.dispose();
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

  async refreshAutoIndex(): Promise<void> {
    if (!this.settings.projectAutoIndex || !this.indexCoordinator) return;
    await this.indexCoordinator.flushPending();
    await this.indexCoordinator.reconcileAll();
  }

  getAutoIndexStatus(): string { return this.autoIndexStatus; }

  private onAutoIndexStatus(status: IndexCoordinatorStatus): void {
    if (status.state === "indexed") {
      const indexed = status.result?.indexed || 0;
      const skipped = status.result?.skipped || 0;
      this.autoIndexStatus = `${status.projectId}: actualizado (${indexed} indexados, ${skipped} sin cambios)`;
    } else if (status.state === "waiting-for-keys") {
      this.autoIndexStatus = `${status.projectId}: esperando Gemini API keys`;
    } else if (status.state === "error") {
      this.autoIndexStatus = `${status.projectId}: error (${status.error || "desconocido"})`;
    } else {
      this.autoIndexStatus = `${status.projectId}: ${status.state}`;
    }
    console.info("[AutoIndex]", this.autoIndexStatus, { pending: status.pending });
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
    // Built-in skill creator (/skill-creator) writes a validated skill definition.
    const skillRequest = parseSkillCreatorCommand(userMessage);
    if (skillRequest) {
      return this.createSkillFromChat(skillRequest, onSkillProgress);
    }

    // ── Agent creator (@agent-creator / @agent-generator) ──
    const genMatch = userMessage.trim().match(/^@(?:agent-creator|agent-generator)(?:\s+([\s\S]*))?$/i);
    if (genMatch) {
      return this.openAgentGenerator(genMatch[1]?.trim() || "");
    }

    const result = await this.chatOrch.handleMessage(userMessage, convMessages, convSummary);
    return result;
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
    const activeProject = this.services.activeProject;
    const projectSnapshot = activeProject ? {
      ...activeProject,
      read_paths: [...activeProject.read_paths],
      write_paths: [...activeProject.write_paths],
      rag: { ...activeProject.rag },
      files: [...(activeProject.files || [])],
      attachedFiles: [...(activeProject.attachedFiles || [])],
    } : null;
    const projectContextSnapshot = this.services.activeProjectContext;
    const vectorStoreSnapshot = this.services.vectorStore;
    const kgEdgeStoreSnapshot = this.kgEdgeStore.snapshot();
    const activeFolderSnapshot = this.activeFolder;
    const kgOptionsSnapshot = { ...this.services.kgOptions };
    const skillContextSnapshot = this.services.skillContext ? {
      ...this.services.skillContext,
      tools: [...(this.services.skillContext.tools || [])],
    } : null;
    const writePathsSnapshot = [...(projectSnapshot?.write_paths || [])];
    const outputPathSnapshot = projectSnapshot?.outputPath || "Research";
    const writeIntent = this.parseWriteIntent(userPrompt);
    let actualPrompt = userPrompt;
    let noteName = (writeIntent?.name || "")
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\.\./g, "")
      .trim();
    if (noteName && !/\.md$/i.test(noteName)) noteName += ".md";

    if (writeIntent) {
      let instruction = `\n\n---\n**Instrucción automática — Modo Creación de Nota:**\nEl usuario ha pedido crear una nota en su base de conocimiento. Tu respuesta final debe estar formateada como un documento Markdown completo. Es OBLIGATORIO que incluyas al final del documento entre 3 y 5 etiquetas (hashtags como \`#quantum-computing\`, \`#concept\`) que conecten semánticamente los temas tratados, para que el sistema de grafos de Obsidian pueda relacionar esta nota con el resto del vault.`;
      if (!noteName) instruction += `\n\nAdemás, tu respuesta debe comenzar EXACTAMENTE con una línea que contenga el identificador del nombre del archivo en este formato: filename: Nombre-Del-Archivo.`;
      actualPrompt = `${userPrompt}${instruction}`;
    }

    const notice = new Notice(`🔀 Ejecutando mesh...`, 0);
    try {
      const result = await runMeshWithCritic({
        userPrompt: actualPrompt,
        vaultAdapter: this.app.vault.adapter,
        opencodeClient: this.opencodeClient,
        geminiBalancer: this.geminiBalancer,
        vectorStore: vectorStoreSnapshot,
        tracer: this.tracer,
        pathFilter: activeFolderSnapshot ? [`${activeFolderSnapshot}/**`] : undefined,
        tavilyApiKey: this.settings.tavilyApiKey,
        kgOptions: kgOptionsSnapshot,
        edgeStore: kgEdgeStoreSnapshot,
        projectContext: projectContextSnapshot || undefined,
        skillContext: skillContextSnapshot || undefined,
      });
      if (result.criticVerdict === "accept" && writeIntent) {
        if (!noteName) {
          const fileMatch = result.researcherOutput.match(/^filename:\s*(.+)/m);
          if (fileMatch) noteName = fileMatch[1].trim().replace(/[<>:"/\\|?*]/g, "").replace(/\.\./g, "").slice(0, 60) + ".md";
          else noteName = `${writeIntent.topic.replace(/[<>:"/\\|?*]/g, "").replace(/\.\./g, "").replace(/\s+/g, "-").slice(0, 40)}.md`;
        }
        const noteFullPath = `${outputPathSnapshot}/${noteName}`;
        try {
          const wr = await writeNoteAtPath(
            { noteWriter: this.noteWriter, vaultAdapter: this.app.vault.adapter, writePaths: writePathsSnapshot },
            noteFullPath,
            result.researcherOutput,
          );
          if (wr.success) result.createdNotePath = wr.path;
          else new Notice(`⚠️ ${wr.message}`);
        } catch (err: any) {
          new Notice(`⚠️ ${err.message}`);
        }
      }
      notice.hide();
      return result;
    } catch (err: any) {
      notice.hide();
      throw err;
    }
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
    if (!this.settings.projectsEnabled) return;
    try {
      await this.ensureProjectDirectories(projectId);
      const project = await this.projectStore.loadProject(projectId);
      // Migrate old project files: add Projects/{id}/ to paths if missing
      const projPath = `/Projects/${projectId}/`;
      let changed = false;
      if (!project.read_paths.includes(projPath)) { project.read_paths.push(projPath); changed = true; }
      if (!project.write_paths.includes(projPath)) { project.write_paths.push(projPath); changed = true; }
      if (!project.outputPath) { project.outputPath = `Projects/${projectId}`; changed = true; }
      if (changed) await this.projectStore.saveProject(project);
      const { store, load } = this.getVectorStoreForProject(projectId);
      await load();
      this.vectorStore = store;
      const { store: kgStore, load: loadKg } = this.getKgEdgeStoreForProject(projectId);
      await loadKg();
      this.kgEdgeStore = kgStore;
      this.services.activeProject = project;
      this.settings.activeProjectId = projectId;
      this.services.activeProjectContext = await buildProjectContext(project, (id) => this.projectStore.loadMemory(id));
      if (newThread) this.services.activeThreadId = this.generateThreadId();
      this.syncServices();
      await this.saveSettings();
      new Notice(`Proyecto activo: ${project.name}`);
      if (this.settings.projectReindexOnOpen) await this.runProjectIndex(project);
      this.rebuildKgEdges();
      this.refreshChatViews();
      this.refreshKgViews();
    } catch (err: any) { new Notice("Error al cambiar de proyecto: " + err.message); }
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
    if (!this.services.activeProject || !threadId) return [];
    const data = await this.projectStore.loadThreadData(this.services.activeProject.id, threadId);
    return data?.messages || [];
  }

  async saveThreadMessages(threadId: string, messages: any[]): Promise<void> {
    if (!this.services.activeProject || !threadId) return;
    await this.projectStore.updateThreadMessages(this.services.activeProject.id, threadId, messages);
  }

  async loadThreadMessagesForProject(projectId: string, threadId: string): Promise<any[]> {
    if (!projectId || !threadId) return [];
    const data = await this.projectStore.loadThreadData(projectId, threadId);
    return data?.messages || [];
  }

  async loadConversationSummaryForProject(projectId: string, threadId: string): Promise<string | undefined> {
    if (!projectId || !threadId) return undefined;
    const data = await this.projectStore.loadThreadData(projectId, threadId);
    return data?.summary;
  }

  async saveThreadMessagesForProject(projectId: string, threadId: string, messages: any[]): Promise<void> {
    if (!projectId || !threadId) return;
    await this.projectStore.updateThreadMessages(projectId, threadId, messages);
  }

  // ── Other legacy methods ──

  private async runProjectIndex(project: Project, folder?: string): Promise<Awaited<ReturnType<typeof indexProject>>> {
    return indexProject(this.app.vault.adapter, this.geminiBalancer, project, this.vectorStore, {
      paths: folder ? [folder] : undefined,
    });
  }

  async indexResearch(folder?: string): Promise<void> {
    if (!this.geminiBalancer.canEmbed) {
      const reason = this.geminiBalancer.hasKeys
        ? `Gemini en cooldown (~${Math.ceil(this.geminiBalancer.cooldownRemainingMs / 1000)}s). Reintentá más tarde.`
        : "Necesitás GEMINI_API_KEYS para indexar";
      new Notice(reason);
      return;
    }
    const project = this.services.activeProject;
    if (!project) { new Notice("No hay un proyecto activo para indexar"); return; }
    const label = folder ? `/${folder}/` : "/Research/";
    const notice = new Notice(`Indexando ${label}...`, 0);
    try {
      const result = await this.runProjectIndex(project, folder);
      notice.hide();
      if (result.errors.length > 0) {
        const exhausted = result.errors.some(e => /agotaron|cooldown|quota|rate limit/i.test(e));
        new Notice(
          exhausted
            ? `Indexado parcial ${label}: ${result.indexed} notas (${result.errors.length} errores — cuota Gemini)`
            : `Indexado ${label}: ${result.totalChunks} chunks (${result.errors.length} errores)`,
        );
        console.warn("Sanctum index errors:", result.errors.slice(0, 5), result.errors.length > 5 ? `(+${result.errors.length - 5} más)` : "");
      } else new Notice(`✅ ${label} indexado: ${result.totalChunks} chunks.`);
    } catch (err: any) { notice.hide(); new Notice(`Error: ${err.message}`); }
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
    const msg = await testEmbeddingsFn(this.geminiBalancer);
    new Notice(msg);
  }

  async testChat(): Promise<void> {
    if (!this.opencodeClient.configured) { new Notice("OPENCODE_GO_API_KEY no configurada"); return; }
    const msg = await testChatFn(this.opencodeClient, this.agent);
    new Notice(msg);
  }

  async runOrchestrate(prompt: string): Promise<void> {
    const agent = this.agent || fallbackAgent();
    try {
      const result = await executeTurn(
        {
          agent,
          opencodeClient: this.opencodeClient,
          geminiBalancer: this.geminiBalancer,
          vectorStore: this.vectorStore,
          tracer: this.tracer,
          tavilyApiKey: this.settings.tavilyApiKey,
          projectContext: this.services.activeProjectContext || undefined,
        },
        prompt,
        false,
        this.pathFilter,
      );
      new Notice(`✅ Orquestación completada (${result.content.slice(0, 80)}…)`);
      console.log("Sanctum orchestrate result:", result.content);
    } catch (err: any) {
      new Notice(`❌ Error: ${err.message}`);
    }
  }

  async createNoteWithAI(): Promise<void> {
    if (!this.opencodeClient.configured) { new Notice("OPENCODE_GO_API_KEY no configurada"); return; }
    const agent = this.agent || fallbackAgent();
    try {
      const path = await createNoteAction({
        agent,
        opencodeClient: this.opencodeClient,
        noteWriter: this.noteWriter,
        tracer: this.tracer,
        vaultAdapter: this.app.vault.adapter,
        writePaths: agent.permissions?.write_paths || [],
      });
      new Notice(`✅ Nota creada: ${path}`);
    } catch (err: any) {
      new Notice(`❌ Error: ${err.message}`);
    }
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
