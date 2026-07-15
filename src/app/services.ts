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
}

/** Fully initialized dependency container shared by views and orchestrators. */
export class AppServices {
  // ── Infrastructure ──
  readonly adapter: VaultAdapter;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  readonly tracer: Tracer;

  // ── Stores (data layer) ──
  vectorStore: VectorStore;
  readonly vectorStores: Map<string, VectorStore>;
  readonly projectStore: ProjectStore;
  kgEdgeStore: KgEdgeStore;
  readonly chainStore: ChainStore;
  readonly noteWriter: NoteWriter;

  // ── Runtime state ──
  settings: SanctumSettings;
  agent: AgentDefinition | null;
  activeFolder: string | null;
  activeProject: Project | null;
  activeProjectContext: ProjectContext | null;
  activeThreadId: string;
  skillContext: Skill | null;

  // ── Helpers injected by the plugin ──
  readonly getSkills: () => Promise<Skill[]>;
  readonly setSkillContext: (id: string | null) => Promise<void>;

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
  }

  /** KgOptions derived from settings */
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
}
