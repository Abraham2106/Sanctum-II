import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { VectorStore } from "../../../src/rag/vector-store.js"
import { IncrementalIndexCoordinator } from "../../../src/projects/index-coordinator.js"
import { ProjectStore } from "../../../src/projects/store.js"
import { embedText } from "../embeddings/gemini-embed.js"
import { log } from "../mcp/logger.js"
import type { RagRuntime } from "./runtime.js"

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

/** Owns the legacy global store and isolated per-project stores used by MCP. */
export class ProjectRagRuntimeRegistry {
  private readonly legacyStore = new VectorStore()
  private readonly stores = new Map<string, VectorStore>()
  private readonly loaded = new Set<string>()
  private readonly projectStore: ProjectStore
  private readonly coordinator: IncrementalIndexCoordinator

  constructor(
    private readonly vault: VaultAdapter,
    private readonly geminiApiKey: string | undefined,
    private readonly defaultProjectId?: string,
  ) {
    this.projectStore = new ProjectStore(vault)
    this.coordinator = new IncrementalIndexCoordinator({
      adapter: vault,
      projectStore: this.projectStore,
      getVectorStore: projectId => this.getProjectStore(projectId),
      getEmbeddingProvider: () => ({ embed: text => embedText(text, this.requireGeminiKey()) }),
      canEmbed: () => Boolean(this.geminiApiKey),
      onStatus: status => {
        const details = { projectId: status.projectId, state: status.state, pending: status.pending, error: status.error }
        if (status.state === "error") log.error("mcp project index", details)
        else log.debug("mcp project index", details)
      },
    })
  }

  async initialize(): Promise<void> {
    await this.legacyStore.load(this.vault)
    log.info("vector store legacy cargado", { chunks: this.legacyStore.count })
    if (this.defaultProjectId) {
      try {
        await this.resolve(this.defaultProjectId)
      } catch (error) {
        log.error("reconciliacion inicial MCP fallida; se reintentara en la consulta", { projectId: this.defaultProjectId, error: String(error) })
      }
    }
  }

  async resolve(requestedProjectId?: string): Promise<RagRuntime> {
    const projectId = requestedProjectId?.trim() || this.defaultProjectId?.trim()
    if (!projectId) return { store: this.legacyStore }
    this.assertProjectId(projectId)
    if (!await this.projectStore.projectExists(projectId)) {
      throw new Error(`PROJECT_NOT_FOUND - No existe sanctum-projects/${projectId}.md`)
    }

    const store = this.getProjectStore(projectId)
    if (!this.loaded.has(projectId)) {
      await store.load(this.vault)
      this.loaded.add(projectId)
    }
    if (this.geminiApiKey) await this.coordinator.reconcileProject(projectId)
    else log.warn("reconciliacion MCP pendiente: Gemini no configurado", { projectId })
    return { store, projectId }
  }

  dispose(): void {
    this.coordinator.dispose()
  }

  private getProjectStore(projectId: string): VectorStore {
    let store = this.stores.get(projectId)
    if (!store) {
      store = new VectorStore(`sanctum-logs/index/${projectId}/vector-store.jsonl`)
      this.stores.set(projectId, store)
    }
    return store
  }

  private requireGeminiKey(): string {
    if (!this.geminiApiKey) throw new Error("GEMINI_NOT_CONFIGURED")
    return this.geminiApiKey
  }

  private assertProjectId(projectId: string): void {
    if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("INVALID_PROJECT_ID - project_id solo admite letras, numeros, guion y guion bajo")
  }
}
