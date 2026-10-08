export const VIEW_TYPE_SANCTUM = "sanctum-ii-chat";
export const RESEARCH_PATH = "Research";

export type LlmProvider = "openai" | "anthropic";

export interface SanctumSettings {
  opencodeApiKey: string;
  opencodeBaseUrl: string;
  llmProvider: LlmProvider;
  llmModel: string;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
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
  projectReindexOnOpen: boolean;
}

export const DEFAULT_SETTINGS: SanctumSettings = {
  opencodeApiKey: "",
  opencodeBaseUrl: "https://api.opencode.ai",
  llmProvider: "openai",
  llmModel: "",
  anthropicApiKey: "",
  anthropicBaseUrl: "https://api.anthropic.com",
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
  projectReindexOnOpen: false,
};

// ── Shared constants ──

export const AGENTS_DIR = "sanctum-agents";
export const PROJECTS_DIR = "sanctum-projects";
export const TRACES_DIR = "sanctum-logs/traces";
export const CHAINS_DIR = "sanctum-chains";

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
