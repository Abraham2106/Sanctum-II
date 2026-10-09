// DEC-0008: diagnostics and manual index actions outside main.

import { fallbackAgent } from "../agents/fallback";
import { testEmbeddings as testEmbeddingsFn, testChat as testChatFn } from "../core/tests";
import { createNoteAction } from "../orchestrator/note-generator";
import { executeTurn } from "../orchestrator/agent-turn";
import { isEmbeddingProviderConfigured, resolveEffectiveEmbeddingConfig } from "../embeddings/embedding-config";
import { getEnv } from "../core/env-loader";
import type { PluginHost } from "./plugin-host";
import type { PluginSession } from "./session";

export class PluginDiagnostics {
  constructor(
    private readonly host: PluginHost,
    private readonly session: PluginSession,
  ) {}

  async getLatestTrace(): Promise<string> {
    try {
      const listing = await this.host.adapter.list("sanctum-logs/traces");
      const traces = (listing.files || []).filter((f) => f.endsWith(".json"));
      if (traces.length === 0) return "No hay traces.";
      traces.sort().reverse();
      return await this.host.adapter.read(traces[0]);
    } catch (err: any) {
      console.warn("[Trace] getLatestTrace:", err.message);
      return "Error al leer traces.";
    }
  }

  async testEmbeddings(): Promise<void> {
    const msg = await testEmbeddingsFn(this.host.geminiBalancer);
    this.host.notice(msg);
  }

  async testChat(): Promise<void> {
    if (!this.host.opencodeClient.configured) {
      this.host.notice("OPENCODE_GO_API_KEY no configurada");
      return;
    }
    const msg = await testChatFn(this.host.opencodeClient, this.host.agent);
    this.host.notice(msg);
  }

  async runOrchestrate(prompt: string): Promise<void> {
    const agent = this.host.agent || fallbackAgent();
    const snap = this.host.services.captureRequestSnapshot(agent);
    try {
      const result = await executeTurn(
        {
          agent: snap.agent || agent,
          opencodeClient: this.host.opencodeClient,
          geminiBalancer: snap.geminiBalancer,
          embedder: snap.embedder,
          vectorStore: snap.vectorStore,
          tracer: this.host.tracer,
          tavilyApiKey: this.host.settings.tavilyApiKey,
          projectContext: snap.projectContext || undefined,
          sealedGeneration: snap.sealedGeneration,
          signal: snap.chatAbort.signal,
        },
        prompt,
        false,
        snap.pathFilter,
      );
      this.host.notice(`✅ Orquestación completada (${result.content.slice(0, 80)}…)`);
      console.log("Sanctum orchestrate result:", result.content);
    } catch (err: any) {
      this.host.notice(`❌ Error: ${err.message}`);
    } finally {
      this.host.services.clearChatAbort();
    }
  }

  async createNoteWithAI(): Promise<void> {
    if (!this.host.opencodeClient.configured) {
      this.host.notice("OPENCODE_GO_API_KEY no configurada");
      return;
    }
    const agent = this.host.agent || fallbackAgent();
    const writePaths = this.host.services.effectiveWritePaths(agent);
    try {
      const path = await createNoteAction({
        agent,
        opencodeClient: this.host.opencodeClient,
        noteWriter: this.host.noteWriter,
        tracer: this.host.tracer,
        vaultAdapter: this.host.adapter,
        writePaths,
      });
      this.host.notice(`✅ Nota creada: ${path}`);
    } catch (err: any) {
      this.host.notice(`❌ Error: ${err.message}`);
    }
  }

  async indexResearch(folder?: string): Promise<void> {
    const project = this.host.services.activeProject;
    if (!project) {
      this.host.notice("No hay un proyecto activo para indexar");
      return;
    }
    const configured = isEmbeddingProviderConfigured(
      resolveEffectiveEmbeddingConfig(this.host.settings, project, getEnv()),
    );
    if (!configured && !this.host.services.embedder.hasKeys) {
      this.host.notice("Proveedor de embeddings no configurado");
      return;
    }
    const label = folder ? `/${folder}/` : "/Research/";
    this.host.notice(`Indexando ${label}...`, 0);
    try {
      const result = await this.session.runProjectIndex(project, folder);
      if (result.errors.length > 0) {
        this.host.notice(`Indexado ${label}: ${result.totalChunks} chunks (${result.errors.length} errores)`);
        console.warn("Sanctum index errors:", result.errors);
      } else {
        this.host.notice(`✅ ${label} indexado: ${result.totalChunks} chunks.`);
      }
    } catch (err: any) {
      this.host.notice(`Error: ${err.message}`);
    }
  }
}
