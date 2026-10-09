import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer } from "../observability/tracer";
import type { NoteWriter } from "../core/note-writer";
import type { KgEdgeStore } from "../kg/kg-store";
import type { ProjectStore } from "../projects/store";
import type { ChainStore } from "../chains/store";
import type { Project } from "../projects/types";
import type { ProjectContext } from "../projects/context";
import type { Skill } from "../skills/types";
import type { SanctumSettings } from "../constants";
import type { AgentDefinition } from "../agents/types";
import type { VaultAdapter } from "../core/vault-adapter";
import type { EmbedderPort, VectorIdentity } from "../runtime/ports";
import type { IndexGenerationSnapshot } from "../projects/index-generations";
import { resolveChatCallOptions } from "../runtime/turn";
import type { GlobalChatConfig } from "../runtime/providers";
import { rebuildEmbedderPort, type EmbeddingHealthSnapshot } from "../plugin/embedding-service";
import type { ProjectIndexService } from "../plugin/index-service";
import { fallbackAgent } from "../agents/fallback";
import { effectiveWritePathsForAgent } from "./write-turn";

export interface AppServicesConfig {
  adapter: VaultAdapter;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  tracer: Tracer;
  vectorStore: VectorStore;
  vectorStores: Map<string, VectorStore>;
  projectStore: ProjectStore;
  kgEdgeStore: KgEdgeStore;
  chainStore: ChainStore;
  noteWriter: NoteWriter;
  settings: SanctumSettings;
  agent?: AgentDefinition | null;
  activeFolder?: string | null;
  activeProject?: Project | null;
  activeProjectContext?: ProjectContext | null;
  activeThreadId: string;
  skillContext?: Skill | null;
  getSkills: () => Promise<Skill[]>;
  setSkillContext: (id: string | null) => Promise<void>;
  globalChat?: GlobalChatConfig;
}

export interface RequestSnapshot {
  projectId: string | undefined;
  threadId: string | undefined;
  project: Project | null;
  agent: AgentDefinition | null;
  pathFilter: string[] | undefined;
  projectContext: ProjectContext | null;
  skillContext: Skill | null;
  vectorStore: VectorStore;
  geminiBalancer: GeminiBalancer;
  embedder: EmbedderPort;
  kgEdgeStore: KgEdgeStore;
  kgOptions: {
    enabled: boolean;
    minSimilarity: number;
    hops: number;
    maxNeighborsPerHop: number;
    useExplicit: boolean;
    reinforceBoost: boolean;
  };
  sealedGeneration?: VectorIdentity;
  indexStatus: IndexGenerationSnapshot["status"];
  chatProvider?: string;
  chatModel?: string;
  chatAbort: AbortController;
}

/** Fully initialized dependency container shared by views and orchestrators. */
export class AppServices {
  readonly adapter: VaultAdapter;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  readonly tracer: Tracer;

  vectorStore: VectorStore;
  readonly vectorStores: Map<string, VectorStore>;
  readonly projectStore: ProjectStore;
  kgEdgeStore: KgEdgeStore;
  readonly chainStore: ChainStore;
  readonly noteWriter: NoteWriter;

  settings: SanctumSettings;
  agent: AgentDefinition | null;
  activeFolder: string | null;
  activeProject: Project | null;
  activeProjectContext: ProjectContext | null;
  activeThreadId: string;
  skillContext: Skill | null;

  readonly getSkills: () => Promise<Skill[]>;
  readonly setSkillContext: (id: string | null) => Promise<void>;

  embedder: EmbedderPort;
  embeddingHealth: EmbeddingHealthSnapshot;
  activeIndexSnapshot: IndexGenerationSnapshot | null = null;
  indexService: ProjectIndexService | null = null;

  private chatAbort: AbortController | null = null;
  private meshAbort: AbortController | null = null;
  private readonly globalChat: GlobalChatConfig;

  constructor(config: AppServicesConfig) {
    this.adapter = config.adapter;
    this.opencodeClient = config.opencodeClient;
    this.geminiBalancer = config.geminiBalancer;
    this.tracer = config.tracer;
    this.vectorStore = config.vectorStore;
    this.vectorStores = config.vectorStores;
    this.projectStore = config.projectStore;
    this.kgEdgeStore = config.kgEdgeStore;
    this.chainStore = config.chainStore;
    this.noteWriter = config.noteWriter;
    this.settings = config.settings;
    this.agent = config.agent ?? null;
    this.activeFolder = config.activeFolder ?? null;
    this.activeProject = config.activeProject ?? null;
    this.activeProjectContext = config.activeProjectContext ?? null;
    this.activeThreadId = config.activeThreadId;
    this.skillContext = config.skillContext ?? null;
    this.getSkills = config.getSkills;
    this.setSkillContext = config.setSkillContext;
    this.globalChat = config.globalChat ?? {
      provider: config.settings.llmProvider,
      model: config.settings.llmModel,
    };
    const built = rebuildEmbedderPort(this.settings, this.geminiBalancer, this.activeProject);
    this.embedder = built.embedder;
    this.embeddingHealth = built.health;
  }

  refreshEmbeddingForProject(): void {
    const built = rebuildEmbedderPort(this.settings, this.geminiBalancer, this.activeProject);
    this.embedder = built.embedder;
    this.embeddingHealth = built.health;
  }

  rebuildEmbeddingFromSettings(): void {
    this.refreshEmbeddingForProject();
  }

  get kgOptions() {
    return {
      enabled: this.settings?.kgEnabled ?? true,
      minSimilarity: this.settings?.kgMinSimilarity ?? 0.75,
      hops: this.settings?.kgHops ?? 1,
      maxNeighborsPerHop: 3,
      useExplicit: this.settings?.kgUseExplicit ?? true,
      reinforceBoost: this.settings?.kgReinforceBoost ?? true,
    };
  }

  get pathFilter(): string[] | undefined {
    return this.activeFolder ? [`${this.activeFolder}/**`] : undefined;
  }

  effectiveWritePaths(agent: AgentDefinition | null): string[] {
    return effectiveWritePathsForAgent(
      this.activeProject?.write_paths,
      agent?.permissions?.write_paths,
    );
  }

  beginChatRequest(): AbortController {
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    return this.chatAbort;
  }

  beginMeshRequest(): AbortController {
    this.meshAbort?.abort();
    this.meshAbort = new AbortController();
    return this.meshAbort;
  }

  cancelChatRequest(): void {
    this.chatAbort?.abort();
    this.chatAbort = null;
  }

  cancelMeshRequest(): void {
    this.meshAbort?.abort();
    this.meshAbort = null;
  }

  clearChatAbort(): void {
    this.chatAbort = null;
  }

  clearMeshAbort(): void {
    this.meshAbort = null;
  }

  captureRequestSnapshot(agentOverride?: AgentDefinition | null): RequestSnapshot {
    const active = this.activeProject;
    const project = active
      ? {
          ...active,
          read_paths: [...active.read_paths],
          write_paths: [...active.write_paths],
          rag: { ...active.rag },
          files: [...(active.files || [])],
          attachedFiles: [...(active.attachedFiles || [])],
        }
      : null;
    const agent = agentOverride ?? this.agent;
    const chatOpts = resolveChatCallOptions(agent || fallbackAgent(), project?.model, this.globalChat);
    const indexStatus = this.activeIndexSnapshot?.status ?? "unavailable";
    const sealedGeneration =
      indexStatus === "ready" && this.activeIndexSnapshot?.identity
        ? {
            ...this.activeIndexSnapshot.identity,
            projectId: project?.id,
            generationId: this.activeIndexSnapshot.generationId,
            provenance: "sanctum.plugin",
          }
        : undefined;
    const chatAbort = this.beginChatRequest();
    return {
      projectId: project?.id,
      threadId: this.activeThreadId,
      project,
      agent,
      pathFilter: this.pathFilter,
      projectContext: this.activeProjectContext,
      skillContext: this.skillContext,
      vectorStore: this.vectorStore,
      geminiBalancer: this.geminiBalancer,
      embedder: this.embedder,
      kgEdgeStore:
        typeof this.kgEdgeStore.snapshot === "function"
          ? this.kgEdgeStore.snapshot()
          : this.kgEdgeStore,
      kgOptions: this.kgOptions,
      sealedGeneration,
      indexStatus,
      chatProvider: chatOpts.provider,
      chatModel: chatOpts.model,
      chatAbort,
    };
  }
}
