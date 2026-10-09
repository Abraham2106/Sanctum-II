import type { SanctumSettings } from "../constants";
import type { Project, ProjectEmbedding } from "../projects/types";
import { ALLOWED_LOCAL_DIMS, LOCAL_MODEL_ID, validateRevisionString } from "./embedding-identity";

export type EmbeddingBackend = "gemini" | "sentence-transformers";

export interface ResolvedEmbeddingConfig {
  backend: EmbeddingBackend;
  model: string;
  revision: string;
  dims: number;
  localPort: number;
  localToken: string;
  localDevice: "cpu" | "cuda";
  localDtype: "float32" | "bfloat16";
  geminiApiKeys: string;
}

export const DEFAULT_LOCAL_EMBED_PORT = 8767;
export const DEFAULT_EMBED_DIMS = 768;
export const HEALTH_TIMEOUT_MS = 5_000;
export const EMBED_DEFAULT_TIMEOUT_MS = 120_000;

export function parseEmbeddingBackend(raw: string | undefined): EmbeddingBackend {
  const normalized = (raw ?? "gemini").trim().toLowerCase();
  if (normalized === "gemini") return "gemini";
  if (normalized === "sentence-transformers") return "sentence-transformers";
  throw new Error(`Unsupported embedding backend: ${raw}`);
}

export function parseLocalDims(raw: string | number | undefined, fallback = DEFAULT_EMBED_DIMS): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? fallback).trim());
  if (!Number.isInteger(value) || !(ALLOWED_LOCAL_DIMS as readonly number[]).includes(value)) {
    throw new Error("INVALID_DIMS");
  }
  return value;
}

export function parseLocalPort(raw: string | number | undefined): number {
  const text = String(raw ?? DEFAULT_LOCAL_EMBED_PORT).trim();
  if (!/^\d+$/.test(text)) throw new Error("INVALID_PORT");
  const port = Number(text);
  if (port < 1 || port > 65535) throw new Error("INVALID_PORT");
  return port;
}

function parseLocalDevice(raw: string | undefined): "cpu" | "cuda" {
  const v = (raw ?? "cpu").trim().toLowerCase();
  if (v === "cpu" || v === "cuda") return v;
  throw new Error("INVALID_DEVICE");
}

function parseLocalDtype(raw: string | undefined, device: "cpu" | "cuda"): "float32" | "bfloat16" {
  const v = (raw ?? (device === "cpu" ? "float32" : "bfloat16")).trim().toLowerCase();
  if (v === "float32" && device === "cpu") return "float32";
  if (v === "bfloat16" && device === "cuda") return "bfloat16";
  throw new Error("UNSUPPORTED_DTYPE");
}

export interface EmbeddingEnvSlice {
  SANCTUM_EMBED_BACKEND?: string;
  SANCTUM_LOCAL_EMBED_PORT?: string;
  SANCTUM_LOCAL_EMBED_TOKEN?: string;
  SANCTUM_LOCAL_EMBED_REVISION?: string;
  SANCTUM_LOCAL_EMBED_DIMS?: string;
  SANCTUM_LOCAL_EMBED_DEVICE?: string;
  SANCTUM_LOCAL_EMBED_DTYPE?: string;
  GEMINI_API_KEYS?: string;
}

export function resolvedEmbeddingFromEnv(env: EmbeddingEnvSlice): Partial<ResolvedEmbeddingConfig> {
  const partial: Partial<ResolvedEmbeddingConfig> = {};
  if (env.SANCTUM_EMBED_BACKEND) {
    partial.backend = parseEmbeddingBackend(env.SANCTUM_EMBED_BACKEND);
  }
  if (env.SANCTUM_LOCAL_EMBED_PORT) {
    partial.localPort = parseLocalPort(env.SANCTUM_LOCAL_EMBED_PORT);
  }
  if (env.SANCTUM_LOCAL_EMBED_TOKEN !== undefined) {
    partial.localToken = env.SANCTUM_LOCAL_EMBED_TOKEN;
  }
  if (env.SANCTUM_LOCAL_EMBED_REVISION) {
    partial.revision = validateRevisionString(env.SANCTUM_LOCAL_EMBED_REVISION.trim());
  }
  if (env.SANCTUM_LOCAL_EMBED_DIMS) {
    partial.dims = parseLocalDims(env.SANCTUM_LOCAL_EMBED_DIMS);
  }
  if (env.SANCTUM_LOCAL_EMBED_DEVICE || env.SANCTUM_LOCAL_EMBED_DTYPE) {
    const device = parseLocalDevice(env.SANCTUM_LOCAL_EMBED_DEVICE);
    partial.localDevice = device;
    partial.localDtype = parseLocalDtype(env.SANCTUM_LOCAL_EMBED_DTYPE, device);
  }
  if (env.GEMINI_API_KEYS !== undefined) {
    partial.geminiApiKeys = env.GEMINI_API_KEYS;
  }
  return partial;
}

export function resolvedEmbeddingFromSettings(settings: SanctumSettings): Partial<ResolvedEmbeddingConfig> {
  const device = parseLocalDevice(settings.localEmbeddingDevice);
  const revisionRaw = settings.localEmbeddingRevision?.trim() ?? "";
  return {
    backend: parseEmbeddingBackend(settings.embeddingBackend),
    localPort: settings.localEmbeddingPort,
    localToken: settings.localEmbeddingToken,
    revision: revisionRaw ? validateRevisionString(revisionRaw) : "",
    dims: settings.localEmbeddingDims,
    localDevice: device,
    localDtype: parseLocalDtype(settings.localEmbeddingDtype, device),
    geminiApiKeys: settings.geminiApiKeys,
  };
}

export function mergeProjectEmbedding(
  global: ResolvedEmbeddingConfig,
  project?: ProjectEmbedding,
): ResolvedEmbeddingConfig {
  if (!project) return global;
  const revisionRaw = project.revision.trim();
  const revision =
    project.backend === "gemini"
      ? revisionRaw || "api"
      : validateRevisionString(revisionRaw);
  return {
    ...global,
    backend: project.backend,
    model: project.model.trim(),
    revision,
    dims: parseLocalDims(project.dims),
  };
}

export function resolveGlobalEmbeddingConfig(
  settings: SanctumSettings,
  env: EmbeddingEnvSlice = {},
): ResolvedEmbeddingConfig {
  const fromSettings = resolvedEmbeddingFromSettings(settings);
  const fromEnv = resolvedEmbeddingFromEnv(env);
  const device = fromEnv.localDevice ?? fromSettings.localDevice ?? parseLocalDevice(undefined);
  const backend = fromEnv.backend ?? fromSettings.backend ?? "gemini";
  return {
    backend,
    model: LOCAL_MODEL_ID,
    revision: fromEnv.revision ?? fromSettings.revision ?? "",
    dims: fromEnv.dims ?? fromSettings.dims ?? DEFAULT_EMBED_DIMS,
    localPort: fromEnv.localPort ?? fromSettings.localPort ?? DEFAULT_LOCAL_EMBED_PORT,
    localToken: fromEnv.localToken ?? fromSettings.localToken ?? "",
    localDevice: device,
    localDtype: fromEnv.localDtype ?? fromSettings.localDtype ?? parseLocalDtype(undefined, device),
    geminiApiKeys: fromEnv.geminiApiKeys ?? fromSettings.geminiApiKeys ?? "",
  };
}

export function resolveEffectiveEmbeddingConfig(
  settings: SanctumSettings,
  project?: Project,
  env: EmbeddingEnvSlice = {},
): ResolvedEmbeddingConfig {
  const global = resolveGlobalEmbeddingConfig(settings, env);
  return mergeProjectEmbedding(global, project?.embedding);
}

/** DEC-0023: provider configured — Gemini keys or local token+revision; never infer backend from model. */
export function isEmbeddingProviderConfigured(config: ResolvedEmbeddingConfig): boolean {
  if (config.backend === "gemini") {
    return config.geminiApiKeys
      .split(",")
      .map((k) => k.trim())
      .some((k) => k.length > 0);
  }
  if (config.backend === "sentence-transformers") {
    return config.localToken.trim().length > 0 && config.revision.length === 40;
  }
  return false;
}

export function embedModelForVectorIdentity(config: ResolvedEmbeddingConfig, projectRagModel: string): string {
  if (config.backend === "sentence-transformers") {
    return config.model.trim() || LOCAL_MODEL_ID;
  }
  return projectRagModel.trim();
}
