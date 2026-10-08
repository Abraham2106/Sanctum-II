// DEC-0008: este trabajo vive aparte del archivo que lo mezcla

import { Notice } from "obsidian";
import type { Vault } from "obsidian";
import { fallbackAgent } from "../agents/fallback";
import type { AgentDefinition } from "../agents/types";
import { testEmbeddings as testEmbeddingsFn, testChat as testChatFn } from "../core/tests";
import { createNoteAction } from "../orchestrator/note-generator";
import { executeTurn } from "../orchestrator/agent-turn";
import type { AppServices } from "../app/services";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer } from "../observability/tracer";
import type { NoteWriter } from "../core/note-writer";
import type { SanctumSettings } from "../constants";
import type { Project } from "../projects/types";
import type { indexProject } from "../projects/indexer";

export interface DiagnosticsPluginHost {
  app: { vault: Vault };
  settings: SanctumSettings;
  services: AppServices;
  agent: AgentDefinition | null;
  geminiBalancer: GeminiBalancer;
  opencodeClient: OpenCodeClient;
  vectorStore: VectorStore;
  tracer: Tracer;
  noteWriter: NoteWriter;
  pathFilter: string[] | undefined;
  runProjectIndex(project: Project, folder?: string): Promise<Awaited<ReturnType<typeof import("../projects/indexer").indexProject>>>;
}

export async function indexResearch(plugin: DiagnosticsPluginHost, folder?: string): Promise<void> {
  if (!plugin.geminiBalancer.hasKeys) {
    new Notice("Necesitás GEMINI_API_KEYS para indexar");
    return;
  }
  const project = plugin.services.activeProject;
  if (!project) {
    new Notice("No hay un proyecto activo para indexar");
    return;
  }
  const label = folder ? `/${folder}/` : "/Research/";
  const notice = new Notice(`Indexando ${label}...`, 0);
  try {
    const result = await plugin.runProjectIndex(project, folder);
    notice.hide();
    if (result.errors.length > 0) {
      new Notice(`Indexado ${label}: ${result.totalChunks} chunks (${result.errors.length} errores)`);
      console.warn("Sanctum index errors:", result.errors);
    } else new Notice(`✅ ${label} indexado: ${result.totalChunks} chunks.`);
  } catch (err: any) {
    notice.hide();
    new Notice(`Error: ${err.message}`);
  }
}

export async function testEmbeddings(plugin: DiagnosticsPluginHost): Promise<void> {
  const msg = await testEmbeddingsFn(plugin.geminiBalancer);
  new Notice(msg);
}

export async function testChat(plugin: DiagnosticsPluginHost): Promise<void> {
  if (!plugin.opencodeClient.configured) {
    new Notice("OPENCODE_GO_API_KEY no configurada");
    return;
  }
  const msg = await testChatFn(plugin.opencodeClient, plugin.agent);
  new Notice(msg);
}

export async function runOrchestrate(plugin: DiagnosticsPluginHost, prompt: string): Promise<void> {
  const agent = plugin.agent || fallbackAgent();
  try {
    const result = await executeTurn(
      {
        agent,
        opencodeClient: plugin.opencodeClient,
        geminiBalancer: plugin.geminiBalancer,
        vectorStore: plugin.vectorStore,
        tracer: plugin.tracer,
        tavilyApiKey: plugin.settings.tavilyApiKey,
        projectContext: plugin.services.activeProjectContext || undefined,
      },
      prompt,
      false,
      plugin.pathFilter,
    );
    new Notice(`✅ Orquestación completada (${result.content.slice(0, 80)}…)`);
    console.log("Sanctum orchestrate result:", result.content);
  } catch (err: any) {
    new Notice(`❌ Error: ${err.message}`);
  }
}

export async function createNoteWithAI(plugin: DiagnosticsPluginHost): Promise<void> {
  if (!plugin.opencodeClient.configured) {
    new Notice("OPENCODE_GO_API_KEY no configurada");
    return;
  }
  const agent = plugin.agent || fallbackAgent();
  try {
    const path = await createNoteAction({
      agent,
      opencodeClient: plugin.opencodeClient,
      noteWriter: plugin.noteWriter,
      tracer: plugin.tracer,
      vaultAdapter: plugin.app.vault.adapter,
      writePaths: agent.permissions?.write_paths || [],
    });
    new Notice(`✅ Nota creada: ${path}`);
  } catch (err: any) {
    new Notice(`❌ Error: ${err.message}`);
  }
}
