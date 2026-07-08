export const VIEW_TYPE_SANCTUM = "sanctum-ii-chat";
export const RESEARCH_PATH = "Research";

export interface SanctumSettings {
  opencodeApiKey: string;
  opencodeBaseUrl: string;
  geminiApiKeys: string;
  tavilyApiKey: string;
}

export const DEFAULT_SETTINGS: SanctumSettings = {
  opencodeApiKey: "",
  opencodeBaseUrl: "https://api.opencode.ai",
  geminiApiKeys: "",
  tavilyApiKey: "",
};
