export const VIEW_TYPE_SANCTUM = "sanctum-ii-chat";
export const RESEARCH_PATH = "Research";

export interface SanctumSettings {
  opencodeApiKey: string;
  opencodeBaseUrl: string;
  geminiApiKeys: string;
  tavilyApiKey: string;
  kgEnabled: boolean;
  kgMinSimilarity: number;
  kgHops: number;
  kgUseExplicit: boolean;
  kgReinforceBoost: boolean;
  kgShowExplicit: boolean;
  kgShowReinforced: boolean;
  kgShowSemantic: boolean;
  kgHighlightCritic: boolean;
  projectsEnabled: boolean;
  activeProjectId: string;
  projectAutoMemory: boolean;
  projectAutoIndex: boolean;
  projectReindexOnOpen: boolean;
}

export const DEFAULT_SETTINGS: SanctumSettings = {
  opencodeApiKey: "",
  opencodeBaseUrl: "https://api.opencode.ai",
  geminiApiKeys: "",
  tavilyApiKey: "",
  kgEnabled: true,
  kgMinSimilarity: 0.75,
  kgHops: 1,
  kgUseExplicit: true,
  kgReinforceBoost: true,
  kgShowExplicit: true,
  kgShowReinforced: true,
  kgShowSemantic: true,
  kgHighlightCritic: true,
  projectsEnabled: true,
  activeProjectId: "sanctum-ii",
  projectAutoMemory: false,
  projectAutoIndex: true,
  projectReindexOnOpen: false,
};

// ── Shared constants ──

export const AGENTS_DIR = "sanctum-agents";
export const PROJECTS_DIR = "sanctum-projects";
export const TRACES_DIR = "sanctum-logs/traces";
export const THREADS_DIR_BASE = "sanctum-logs/threads";
export const INDEX_DIR_BASE = "sanctum-logs/index";
export const MEMORY_DIR_BASE = "sanctum-memory";
export const CHAINS_DIR = "sanctum-chains";
export const KG_DIR = "sanctum-logs/kg";

export const DEFAULT_MODEL = "deepseek-v4-flash";

export const BUILTIN_AGENTS = {
  FORAGER: "forager",
  RESEARCHER: "researcher",
  CRITIC: "critic",
  ORCHESTRATOR: "orchestrator",
} as const;

export const MESH_THRESHOLDS = {
  ACCEPT: 80,
  ESCALATE: 40,
  MAX_ATTEMPTS: 3,
} as const;

export const RAG_DEFAULTS = {
  MIN_SIMILARITY: 0.65,
  TOP_K: 5,
} as const;
