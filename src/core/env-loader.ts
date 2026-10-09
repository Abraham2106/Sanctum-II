import * as fs from "fs";
import * as path from "path";

export interface SanctumEnv {
  OPENCODE_GO_API_KEY: string;
  OPENCODE_GO_BASE_URL: string;
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL: string;
  GEMINI_API_KEYS: string;
  TAVILY_API_KEY: string;
  SANCTUM_EMBED_BACKEND: string;
  SANCTUM_LOCAL_EMBED_PORT: string;
  SANCTUM_LOCAL_EMBED_TOKEN: string;
  SANCTUM_LOCAL_EMBED_REVISION: string;
  SANCTUM_LOCAL_EMBED_DIMS: string;
  SANCTUM_LOCAL_EMBED_DEVICE: string;
  SANCTUM_LOCAL_EMBED_DTYPE: string;
}

export function loadEnvFile(envPath?: string): Partial<SanctumEnv> {
  const resolvedPath = envPath || path.resolve(process.cwd(), ".env");
  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

export function getEnv(): SanctumEnv {
  const envFile = loadEnvFile();

  const opencodeApiKey = envFile.OPENCODE_GO_API_KEY || process.env.OPENCODE_GO_API_KEY || "";
  const opencodeBaseUrl = envFile.OPENCODE_GO_BASE_URL || process.env.OPENCODE_GO_BASE_URL || "https://api.opencode.ai";
  const llmProvider = envFile.LLM_PROVIDER || process.env.LLM_PROVIDER || "openai";
  const llmModel = envFile.LLM_MODEL || process.env.LLM_MODEL || "";
  const anthropicApiKey = envFile.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  const anthropicBaseUrl =
    envFile.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const geminiKeys = envFile.GEMINI_API_KEYS || process.env.GEMINI_API_KEYS || "";
  const tavilyKey = envFile.TAVILY_API_KEY || process.env.TAVILY_API_KEY || "";
  const embedBackend = envFile.SANCTUM_EMBED_BACKEND || process.env.SANCTUM_EMBED_BACKEND || "";
  const localEmbedPort = envFile.SANCTUM_LOCAL_EMBED_PORT || process.env.SANCTUM_LOCAL_EMBED_PORT || "";
  const localEmbedToken =
    envFile.SANCTUM_LOCAL_EMBED_TOKEN || process.env.SANCTUM_LOCAL_EMBED_TOKEN || "";
  const localEmbedRevision =
    envFile.SANCTUM_LOCAL_EMBED_REVISION || process.env.SANCTUM_LOCAL_EMBED_REVISION || "";
  const localEmbedDims = envFile.SANCTUM_LOCAL_EMBED_DIMS || process.env.SANCTUM_LOCAL_EMBED_DIMS || "";
  const localEmbedDevice =
    envFile.SANCTUM_LOCAL_EMBED_DEVICE || process.env.SANCTUM_LOCAL_EMBED_DEVICE || "";
  const localEmbedDtype = envFile.SANCTUM_LOCAL_EMBED_DTYPE || process.env.SANCTUM_LOCAL_EMBED_DTYPE || "";

  return {
    OPENCODE_GO_API_KEY: opencodeApiKey,
    OPENCODE_GO_BASE_URL: opencodeBaseUrl,
    LLM_PROVIDER: llmProvider,
    LLM_MODEL: llmModel,
    ANTHROPIC_API_KEY: anthropicApiKey,
    ANTHROPIC_BASE_URL: anthropicBaseUrl,
    GEMINI_API_KEYS: geminiKeys,
    TAVILY_API_KEY: tavilyKey,
    SANCTUM_EMBED_BACKEND: embedBackend,
    SANCTUM_LOCAL_EMBED_PORT: localEmbedPort,
    SANCTUM_LOCAL_EMBED_TOKEN: localEmbedToken,
    SANCTUM_LOCAL_EMBED_REVISION: localEmbedRevision,
    SANCTUM_LOCAL_EMBED_DIMS: localEmbedDims,
    SANCTUM_LOCAL_EMBED_DEVICE: localEmbedDevice,
    SANCTUM_LOCAL_EMBED_DTYPE: localEmbedDtype,
  };
}
