import { Notice, Plugin, TFile } from "obsidian";
import { getEnv } from "./core/env-loader";
import { GeminiBalancer } from "./embeddings/gemini-balancer";
import { OpenCodeClient } from "./llm/opencode-client";
import { loadAgentFromVault } from "./agents/agent-loader";
import { fallbackAgent } from "./agents/fallback";
import type { AgentDefinition } from "./agents/types";
import { VectorStore } from "./rag/vector-store";
import { indexResearchFolder } from "./rag/indexer";
import { NoteWriter } from "./core/note-writer";
import { Tracer } from "./observability/tracer";
import { VIEW_TYPE_SANCTUM, DEFAULT_SETTINGS } from "./constants";
import type { SanctumSettings } from "./constants";
import { SanctumChatView, type ChatViewPlugin } from "./ui/chat-view";
import { SanctumSettingTab, type SettingsTabPlugin } from "./ui/settings-tab";
import { registerCommands } from "./core/commands";
import { testEmbeddings as testEmbeddingsFn, testChat as testChatFn } from "./core/tests";
import { createNoteAction } from "./orchestrator/note-generator";
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

import { executeTurn } from "./orchestrator/agent-turn";
import { AppServices } from "./app/services";
import { ChatOrchestrator } from "./app/chat-orchestrator";
import { parseWriteIntent as parseWriteIntentFromUtils } from "./utils";


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

  async getSkills(): Promise<Skill[]> { return listSkills(this.app.vault.adapter); }
  async setSkillContext(skillId: string | null): Promise<void> {
    this.services.skillContext = skillId ? await loadSkill(this.app.vault.adapter, skillId) : null;
    if (skillId && this.services.skillContext) new Notice(`🧠 Skill activo: ${this.services.skillContext.name}`);
    else this.services.skillContext = null;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.vectorStore = new VectorStore();
    await this.vectorStore.load(this.app.vault.adapter);
    this.rebuildClients();
    await this.loadAgent();
    this.noteWriter = new NoteWriter(this.app.vault.adapter);
    this.tracer = new Tracer(this.app.vault.adapter);
    this.app.vault.adapter.write("sanctum-logs/traces/.gitkeep", "").catch((err: any) => { if (err) console.warn("[Init] traces dir:", err.message); });

    this.kgEdgeStore = new KgEdgeStore();
    await this.kgEdgeStore.load(this.app.vault.adapter);
    await this.rebuildKgEdges();

    this.projectStore = new ProjectStore(this.app.vault.adapter);
    this.chainStore = new ChainStore(this.app.vault.adapter);
    // Ensure chain directory exists
    await this.app.vault.adapter.write("sanctum-chains/.gitkeep", "").catch((err: any) => { if (err) console.warn("[Init] chains dir:", err.message); });

    // ── Init AppServices ──
    this.services = new AppServices();
    Object.assign(this.services, {
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
    this.registerView(VIEW_TYPE_PROJECTS, (leaf) => new ProjectsView(leaf, { projectStore: this.projectStore, geminiBalancer: this.geminiBalancer, getActiveProjectId: () => this.services.activeProject?.id || this.settings.activeProjectId, getVectorStore: (id) => this.getVectorStoreForProject(id), onSelectProject: (id) => this.setActiveProject(id), onOpenThread: async (message, threadId) => { if (threadId) this.services.activeThreadId = threadId; else this.services.activeThreadId = this.generateThreadId(); await this.initLeaf(); const chatViews = this.app.workspace.getLeavesOfType(VIEW_TYPE_SANCTUM); for (const leaf of chatViews) { const view = leaf.view as any; if (view) { view.setThreadId(this.services.activeThreadId); if (message) await view.postMessage(message); else if (view.reloadForProject) await view.reloadForProject(this.services.activeThreadId); break; } } this.refreshProjectViews(); }, loadMemory: (id) => this.projectStore.loadMemory(id), appendMemory: async (text, source) => { const pid = this.services.activeProject?.id || this.settings.activeProjectId; await this.projectStore.appendMemory(pid, { text, source: source || "manual", timestamp: Date.now() }); }, saveProject: (p) => this.projectStore.saveProject(p), getVectorCount: (id) => this.vectorStores.get(id)?.count || 0 }));
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
    );
    this.geminiBalancer = new GeminiBalancer(this.settings.geminiApiKeys || env.GEMINI_API_KEYS);
    if (!this.settings.tavilyApiKey) this.settings.tavilyApiKey = env.TAVILY_API_KEY;
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

  async sendChatMessage(userMessage: string, convMessages?: any[], convSummary?: string): Promise<string> {
    // ── Agent generator (@agent-generator) ──
    const genMatch = userMessage.trim().match(/^@agent-generator(?:\s+([\s\S]*))?$/i);
    if (genMatch) {
      const { AgentGeneratorModal } = await import("./ui/agent-generator-modal");
      const modal = new AgentGeneratorModal(this.app);
      const result = await modal.ask();
      if (result) {
        const content = `---\nid: ${result.id}\nname: "${result.name}"\navatar: "${result.icon}"\ndescription: "${result.description}"\ntools: [${result.tools.join(", ")}]\npermissions:\n  read_paths: ["${result.read_paths.join("\", \"")}"]\n  write_paths: ${result.write_paths.length ? `["${result.write_paths.join("\", \"")}"]` : "[]"}\n---\n${result.instructions}\n\n{{rag_context}}\n\n{{user_prompt}}`;
        try {
          await this.app.vault.adapter.write(`sanctum-agents/${result.id}.md`, content);
          new Notice(`✅ Agente "${result.name}" creado en sanctum-agents/${result.id}.md`);
          return `✅ **Agente creado exitosamente:** @${result.id}\n\n**Nombre:** ${result.name}\n**Descripción:** ${result.description}\n**Icono:** ${result.icon}\n\nPodés mencionarlo con @${result.id} en el chat.`;
        } catch (err: any) {
          return `❌ Error al crear el agente: ${err.message}`;
        }
      }
      return "❌ Creación de agente cancelada.";
    }

    const result = await this.chatOrch.handleMessage(userMessage, convMessages, convSummary);
    return result.content;
  }

  async runMesh(userPrompt: string): Promise<MeshResultFull> {
    const writeIntent = this.parseWriteIntent(userPrompt);
    let actualPrompt = userPrompt;
    let noteName = writeIntent?.name || "";

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
        vectorStore: this.vectorStore,
        tracer: this.tracer,
        pathFilter: this.activeFolder ? [`${this.activeFolder}/**`] : undefined,
        tavilyApiKey: this.settings.tavilyApiKey,
        kgOptions: this.services.kgOptions,
        edgeStore: this.kgEdgeStore,
        projectContext: this.services.activeProjectContext || undefined,
        skillContext: this.services.skillContext || undefined,
      });
      if (result.criticVerdict === "accept" && writeIntent) {
        if (!noteName) {
          const fileMatch = result.researcherOutput.match(/^filename:\s*(.+)/m);
          if (fileMatch) noteName = fileMatch[1].trim().replace(/[<>:"/\\|?*]/g, "").slice(0, 60) + ".md";
          else noteName = `${writeIntent.topic.replace(/\s+/g, "-").slice(0, 40)}.md`;
        }
        const outputPath = this.services.activeProject?.outputPath || "Research";
        const noteFullPath = `${outputPath}/${noteName}`;
        const { canWriteToPath } = await import("./orchestrator/note-generator");
        if (!canWriteToPath(noteFullPath, this.services.activeProject?.write_paths || [])) {
          new Notice(`⚠️ Permiso denegado: no se puede escribir en ${noteFullPath}`);
        } else {
          const wr = await this.noteWriter.create(noteName, result.researcherOutput);
          if (wr.success) result.createdNotePath = wr.path;
          else new Notice(`⚠️ ${wr.message}`);
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

  private async initProjects(): Promise<void> {
    if (!this.settings.projectsEnabled) return;
    const ensureDir = async (dir: string) => { await this.app.vault.adapter.write(`${dir}/.gitkeep`, "").catch((err: any) => { if (err) console.warn(`[Init] ensureDir ${dir}:`, err.message); }); };
    await ensureDir("sanctum-projects");
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
    const pid = this.settings.activeProjectId;
    await ensureDir(`sanctum-memory/${pid}`);
    await ensureDir(`sanctum-logs/threads/${pid}`);
    await ensureDir(`sanctum-logs/index/${pid}`);
    await ensureDir(`Projects/${pid}`);
    await this.setActiveProject(this.settings.activeProjectId, false);
  }

  async setActiveProject(projectId: string, newThread: boolean = true): Promise<void> {
    if (!this.settings.projectsEnabled) return;
    try {
      const project = await this.projectStore.loadProject(projectId);
      // Ensure Projects/{projectId}/ directory exists for generated notes
      const ensureDir = async (dir: string) => {
        const parts = dir.split("/");
        for (let i = 1; i <= parts.length; i++) {
          try { await this.app.vault.adapter.write(`${parts.slice(0, i).join("/")}/.gitkeep`, ""); } catch (err: any) { if (err) console.warn(`[Project] mkdir ${parts.slice(0, i).join("/")}:`, err.message); }
        }
      };
      await ensureDir(`Projects/${projectId}`);
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
      this.services.activeProject = project;
      this.settings.activeProjectId = projectId;
      this.services.activeProjectContext = await buildProjectContext(project, (id) => this.projectStore.loadMemory(id));
      if (newThread) this.services.activeThreadId = this.generateThreadId();
      this.services.vectorStore = this.vectorStore;
      await this.saveSettings();
      new Notice(`Proyecto activo: ${project.name}`);
      if (this.settings.projectReindexOnOpen) await indexProject(this.app.vault.adapter, this.geminiBalancer, project, this.vectorStore);
      this.rebuildKgEdges();
      this.refreshChatViews();
    } catch (err: any) { new Notice("Error al cambiar de proyecto: " + err.message); }
  }

  private getVectorStoreForProject(projectId: string): { store: VectorStore; load: () => Promise<void>; save: () => Promise<void> } {
    let store = this.vectorStores.get(projectId);
    if (!store) { store = new VectorStore(`sanctum-logs/index/${projectId}/vector-store.jsonl`); this.vectorStores.set(projectId, store); }
    return { store, load: async () => { await store!.load(this.app.vault.adapter); }, save: async () => { await store!.save(this.app.vault.adapter); } };
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

  // ── Other legacy methods ──

  async indexResearch(folder?: string): Promise<void> {
    if (!this.geminiBalancer.hasKeys) { new Notice("Necesitás GEMINI_API_KEYS para indexar"); return; }
    const label = folder ? `/${folder}/` : "/Research/";
    const notice = new Notice(`Indexando ${label}...`, 0);
    try {
      if (!folder) this.vectorStore.clear();
      const result = await indexResearchFolder(this.app.vault.adapter, this.geminiBalancer, this.vectorStore, folder);
      const storePath = this.vectorStore.getStorePath();
      const dir = storePath.substring(0, storePath.lastIndexOf("/"));
      await this.app.vault.adapter.write(`${dir}/.gitkeep`, "").catch((_err: any) => {});
      await this.vectorStore.save(this.app.vault.adapter);
      notice.hide();
      if (result.errors.length > 0) {
        new Notice(`Indexado ${label}: ${result.totalChunks} chunks (${result.errors.length} errores)`);
        console.warn("Sanctum index errors:", result.errors);
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
    if (!leaf) { leaf = workspace.getRightLeaf(false)!; await leaf.setViewState({ type: viewType, active: true }); }
    workspace.revealLeaf(leaf);
  }

  async initLeaf(): Promise<void> { return this.activateView(VIEW_TYPE_SANCTUM); }
  async activateKgView(): Promise<void> { return this.activateView(VIEW_TYPE_KG); }
  async activateProjectsView(): Promise<void> { return this.activateView(VIEW_TYPE_PROJECTS); }
  async activateChainsView(): Promise<void> { return this.activateView(VIEW_TYPE_CHAINS); }

  private refreshChatViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SANCTUM);
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view?.reloadForProject) view.reloadForProject(this.services.activeThreadId);
    }
  }

  private refreshProjectViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PROJECTS);
    for (const leaf of leaves) { const view = leaf.view as any; if (view?.refresh) view.refresh(); }
  }
}
