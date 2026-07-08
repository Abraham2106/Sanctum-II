import * as fs from "fs";
import * as path from "path";

export interface SanctumEnv {
  OPENCODE_GO_API_KEY: string;
  OPENCODE_GO_BASE_URL: string;
  GEMINI_API_KEYS: string;
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
  const geminiKeys = envFile.GEMINI_API_KEYS || process.env.GEMINI_API_KEYS || "";

  return {
    OPENCODE_GO_API_KEY: opencodeApiKey,
    OPENCODE_GO_BASE_URL: opencodeBaseUrl,
    GEMINI_API_KEYS: geminiKeys,
  };
}
