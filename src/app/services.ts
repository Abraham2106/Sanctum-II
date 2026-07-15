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

export interface VaultAdapter {
  read: (p: string) => Promise<string>;
  write: (p: string, c: string) => Promise<void>;
  list: (p: string) => Promise<{ files: string[]; folders: string[] }>;
  exists: (p: string) => Promise<boolean>;
  append?: (p: string, c: string) => Promise<void>;
}

/**
 * Central dependency injection container.
 * Holds references to all application services and runtime state.
 * ItemViews and orchestrators receive this instead of individual deps.
 *
 * KNOWN DEBT: All fields use `!` (definite assignment assertion) with no runtime
 * validation. A caller accessing an uninitialized field gets undefined at best, a
 * crash at worst. Fix: replace with a factory function that returns a fully-
 * initialized AppServices instance, or add getters that throw if accessed before
 * initialization.
 */
export class AppServices {
  // ── Infrastructure ──
  adapter!: VaultAdapter;
  opencodeClient!: OpenCodeClient;
  geminiBalancer!: GeminiBalancer;
  tracer!: Tracer;

  // ── Stores (data layer) ──
  vectorStore!: VectorStore;
  vectorStores!: Map<string, VectorStore>;
  projectStore!: ProjectStore;
  kgEdgeStore!: KgEdgeStore;
  chainStore!: ChainStore;
  noteWriter!: NoteWriter;

  // ── Runtime state ──
  settings!: SanctumSettings;
  agent!: AgentDefinition | null;
  activeFolder!: string | null;
  activeProject!: Project | null;
  activeProjectContext!: ProjectContext | null;
  activeThreadId!: string;
  skillContext!: Skill | null;

  // ── Helpers injected by the plugin ──
  getSkills!: () => Promise<Skill[]>;
  setSkillContext!: (id: string | null) => Promise<void>;

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
