// DEC-0008: Obsidian view registration outside main.

import { SanctumChatView } from "../ui/chat-view";
import { VIEW_TYPE_SANCTUM } from "../constants";
import { KgView, VIEW_TYPE_KG } from "../ui/kg-view";
import { ProjectsView, VIEW_TYPE_PROJECTS } from "../ui/projects-view";
import { ChainView, VIEW_TYPE_CHAINS } from "../ui/chain-view";
import { registerCommands } from "../core/commands";
import { SanctumSettingTab } from "../ui/settings-tab";
import { fallbackAgent } from "../agents/fallback";
import type SanctumPlugin from "../main";
import type { PluginSession } from "./session";

export function registerPluginViews(plugin: SanctumPlugin, session: PluginSession): void {
  plugin.registerView(VIEW_TYPE_SANCTUM, (leaf) => {
    const view = new SanctumChatView(leaf, plugin);
    view.setThreadId(plugin.services.activeThreadId);
    return view;
  });
  plugin.registerView(VIEW_TYPE_KG, (leaf) => new KgView(leaf, {
    edgeStore: plugin.kgEdgeStore,
    onSendToChat: (seed) => plugin.notice(`Enviando "${seed}" al chat…`),
  }));
  plugin.registerView(VIEW_TYPE_PROJECTS, (leaf) => new ProjectsView(leaf, {
    projectStore: plugin.projectStore,
    geminiBalancer: plugin.geminiBalancer,
    vaultAdapter: plugin.app.vault.adapter,
    getActiveProjectId: () => plugin.services.activeProject?.id || plugin.settings.activeProjectId,
    getVectorStore: (id) => session.getVectorStoreForProject(id),
    onSelectProject: (id) => plugin.setActiveProject(id),
    onOpenThread: (message, threadId) => plugin.openThreadFromProjects(message, threadId),
    loadMemory: (id) => plugin.projectStore.loadMemory(id),
    appendMemory: async (text, source) => {
      const pid = plugin.services.activeProject?.id || plugin.settings.activeProjectId;
      await plugin.projectStore.appendMemory(pid, {
        text,
        source: source || "manual",
        timestamp: Date.now(),
      });
    },
    saveProject: (p) => plugin.projectStore.saveProject(p),
    getVectorCount: (id) => plugin.vectorStores.get(id)?.count || 0,
  }));
  plugin.registerView(VIEW_TYPE_CHAINS, (leaf) => new ChainView(leaf, {
    chainStore: plugin.chainStore,
    vaultAdapter: plugin.app.vault.adapter,
    getTurnDeps: () => ({
      agent: plugin.agent || fallbackAgent(),
      opencodeClient: plugin.opencodeClient,
      geminiBalancer: plugin.geminiBalancer,
      embedder: plugin.services.embedder,
      vectorStore: plugin.vectorStore,
      tracer: plugin.tracer,
      tavilyApiKey: plugin.settings.tavilyApiKey,
      kgOptions: plugin.services.kgOptions,
      edgeStore: plugin.kgEdgeStore,
      projectContext: plugin.services.activeProjectContext || undefined,
      skillContext: plugin.services.skillContext || undefined,
      sealedGeneration:
        plugin.services.activeIndexSnapshot?.status === "ready" &&
        plugin.services.activeIndexSnapshot.identity
          ? {
              ...plugin.services.activeIndexSnapshot.identity,
              projectId: plugin.services.activeProject?.id,
              generationId: plugin.services.activeIndexSnapshot.generationId,
              provenance: "sanctum.plugin.chain",
            }
          : undefined,
    }),
  }));

  plugin.addRibbonIcon("bot", "Sanctum II — Chat", () => plugin.initLeaf());
  plugin.addRibbonIcon("git-fork", "Knowledge Graph", () => plugin.activateKgView());
  plugin.addRibbonIcon("folders", "Proyectos", () => plugin.activateProjectsView());
  plugin.addRibbonIcon("git-branch", "Orquestador", () => plugin.activateChainsView());
  plugin.addCommand({ id: "open-kg", name: "Abrir Knowledge Graph", callback: () => plugin.activateKgView() });
  plugin.addCommand({ id: "open-projects", name: "Abrir Proyectos", callback: () => plugin.activateProjectsView() });
  plugin.addCommand({ id: "open-chains", name: "Abrir Orquestador de Cadenas", callback: () => plugin.activateChainsView() });
  plugin.addCommand({
    id: "create-agent",
    name: "Crear o validar agente",
    callback: () => { void plugin.openAgentGeneratorPublic(); },
  });
  registerCommands(plugin);
  plugin.addSettingTab(new SanctumSettingTab(plugin.app, plugin));
}
