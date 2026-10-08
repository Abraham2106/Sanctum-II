// DEC-0008: este trabajo vive aparte del archivo que lo mezcla

import { Notice } from "obsidian";
import type { Vault } from "obsidian";
import type { AppServices } from "../app/services";
import type { SanctumSettings } from "../constants";
import type { ProjectStore } from "../projects/store";
import type { VectorStore } from "../rag/vector-store";
import type { KgEdgeStore } from "../kg/kg-store";
import type { Project } from "../projects/types";
import { buildProjectContext } from "../projects/context";

export interface SessionPluginHost {
  app: { vault: Vault };
  settings: SanctumSettings;
  services: AppServices;
  vectorStore: VectorStore;
  kgEdgeStore: KgEdgeStore;
  projectStore: ProjectStore;
  ensureProjectDirectories(projectId: string): Promise<void>;
  getVectorStoreForProject(projectId: string): { store: VectorStore; load: () => Promise<void>; save: () => Promise<void> };
  getKgEdgeStoreForProject(projectId: string): { store: KgEdgeStore; load: () => Promise<void>; save: () => Promise<void> };
  syncServices(): void;
  saveSettings(): Promise<void>;
  generateThreadId(): string;
  runProjectIndex(project: Project, folder?: string): Promise<unknown>;
  rebuildKgEdges(): Promise<void>;
  refreshChatViews(): void;
  refreshKgViews(): void;
}

export async function setActiveProject(
  plugin: SessionPluginHost,
  projectId: string,
  newThread: boolean = true,
): Promise<void> {
  if (!plugin.settings.projectsEnabled) return;
  try {
    await plugin.ensureProjectDirectories(projectId);
    const project = await plugin.projectStore.loadProject(projectId);
    const projPath = `/Projects/${projectId}/`;
    let changed = false;
    if (!project.read_paths.includes(projPath)) {
      project.read_paths.push(projPath);
      changed = true;
    }
    if (!project.write_paths.includes(projPath)) {
      project.write_paths.push(projPath);
      changed = true;
    }
    if (!project.outputPath) {
      project.outputPath = `Projects/${projectId}`;
      changed = true;
    }
    if (changed) await plugin.projectStore.saveProject(project);
    const { store, load } = plugin.getVectorStoreForProject(projectId);
    await load();
    plugin.vectorStore = store;
    const { store: kgStore, load: loadKg } = plugin.getKgEdgeStoreForProject(projectId);
    await loadKg();
    plugin.kgEdgeStore = kgStore;
    plugin.services.activeProject = project;
    plugin.settings.activeProjectId = projectId;
    plugin.services.activeProjectContext = await buildProjectContext(project, (id) => plugin.projectStore.loadMemory(id));
    if (newThread) plugin.services.activeThreadId = plugin.generateThreadId();
    plugin.syncServices();
    await plugin.saveSettings();
    new Notice(`Proyecto activo: ${project.name}`);
    if (plugin.settings.projectReindexOnOpen) await plugin.runProjectIndex(project);
    plugin.rebuildKgEdges();
    plugin.refreshChatViews();
    plugin.refreshKgViews();
  } catch (err: any) {
    new Notice("Error al cambiar de proyecto: " + err.message);
  }
}

export async function loadThreadMessages(plugin: SessionPluginHost, threadId: string): Promise<any[]> {
  if (!plugin.services.activeProject || !threadId) return [];
  const data = await plugin.projectStore.loadThreadData(plugin.services.activeProject.id, threadId);
  return data?.messages || [];
}

export async function saveThreadMessages(plugin: SessionPluginHost, threadId: string, messages: any[]): Promise<void> {
  if (!plugin.services.activeProject || !threadId) return;
  await plugin.projectStore.updateThreadMessages(plugin.services.activeProject.id, threadId, messages);
}

export async function loadThreadMessagesForProject(
  plugin: SessionPluginHost,
  projectId: string,
  threadId: string,
): Promise<any[]> {
  if (!projectId || !threadId) return [];
  const data = await plugin.projectStore.loadThreadData(projectId, threadId);
  return data?.messages || [];
}

export async function loadConversationSummaryForProject(
  plugin: SessionPluginHost,
  projectId: string,
  threadId: string,
): Promise<string | undefined> {
  if (!projectId || !threadId) return undefined;
  const data = await plugin.projectStore.loadThreadData(projectId, threadId);
  return data?.summary;
}

export async function saveThreadMessagesForProject(
  plugin: SessionPluginHost,
  projectId: string,
  threadId: string,
  messages: any[],
): Promise<void> {
  if (!projectId || !threadId) return;
  await plugin.projectStore.updateThreadMessages(projectId, threadId, messages);
}
