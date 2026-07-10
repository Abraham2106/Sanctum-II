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
  projectReindexOnOpen: false,
};
