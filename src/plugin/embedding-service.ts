// DEC-0008: embedding wiring lives outside main composition.
// DEC-0023: shared embedder port, loopback transport, health snapshot.

import { getEnv } from "../core/env-loader";
import { createLoopbackNodeTransport } from "../embeddings/local-node-transport";
import { LocalEmbeddingClient, LocalEmbeddingClientError } from "../embeddings/local-client";
import type { ResolvedEmbeddingConfig } from "../embeddings/embedding-config";
import { resolveEffectiveEmbeddingConfig, isEmbeddingProviderConfigured } from "../embeddings/embedding-config";
import type { EmbeddingIdentityDocument } from "../embeddings/embedding-identity";
import type { SanctumSettings } from "../constants";
import type { Project } from "../projects/types";
import {
  createConfiguredEmbedderPort,
  pinQueryEmbeddingIdentity,
  resolveRuntimeEmbeddingConfig,
} from "../runtime/embedding";
import type { EmbedderPort } from "../runtime/ports";

export type EmbeddingHealthCode =
  | "ready"
  | "unconfigured"
  | "missing_runtime"
  | "auth_failure"
  | "config_mismatch"
  | "loading"
  | "failed";

export interface EmbeddingHealthSnapshot {
  state: EmbeddingHealthCode;
  identity: EmbeddingIdentityDocument | null;
  config: ResolvedEmbeddingConfig;
  providerConfigured: boolean;
}

export function buildEmbeddingRuntimeContext(
  settings: SanctumSettings,
  project?: Project | null,
): {
  settings: SanctumSettings;
  project?: Project;
  env: ReturnType<typeof getEnv>;
  geminiBalancer?: import("../embeddings/gemini-balancer").GeminiBalancer;
  localClient?: LocalEmbeddingClient;
} {
  const env = getEnv();
  const config = resolveEffectiveEmbeddingConfig(settings, project ?? undefined, env);
  const localClient =
    config.backend === "sentence-transformers"
      ? new LocalEmbeddingClient({
          config: {
            localPort: config.localPort,
            localToken: config.localToken,
            dims: config.dims,
          },
          transport: createLoopbackNodeTransport(),
        })
      : undefined;
  return { settings, project: project ?? undefined, env, localClient };
}

export function rebuildEmbedderPort(
  settings: SanctumSettings,
  geminiBalancer: import("../embeddings/gemini-balancer").GeminiBalancer,
  project?: Project | null,
): { embedder: EmbedderPort; health: EmbeddingHealthSnapshot } {
  const ctx = buildEmbeddingRuntimeContext(settings, project);
  ctx.geminiBalancer = geminiBalancer;
  const config = resolveRuntimeEmbeddingConfig(ctx);
  const providerConfigured = isEmbeddingProviderConfigured(config);
  const embedder = createConfiguredEmbedderPort(ctx);

  const baseHealth: EmbeddingHealthSnapshot = {
    state: providerConfigured ? "ready" : "unconfigured",
    identity: null,
    config,
    providerConfigured,
  };

  if (config.backend === "gemini") {
    if (!geminiBalancer.hasKeys) {
      return { embedder, health: { ...baseHealth, state: "unconfigured", providerConfigured: false } };
    }
    return { embedder, health: baseHealth };
  }

  if (!providerConfigured) {
    return { embedder, health: { ...baseHealth, state: "unconfigured" } };
  }

  return { embedder, health: { ...baseHealth, state: "missing_runtime" } };
}

export async function refreshLocalEmbeddingHealth(
  settings: SanctumSettings,
  geminiBalancer: import("../embeddings/gemini-balancer").GeminiBalancer,
  project?: Project | null,
  signal?: AbortSignal,
): Promise<EmbeddingHealthSnapshot> {
  const { embedder, health } = rebuildEmbedderPort(settings, geminiBalancer, project);
  const config = health.config;
  if (config.backend === "gemini") {
    return health;
  }
  if (!health.providerConfigured) {
    return health;
  }
  const ctx = buildEmbeddingRuntimeContext(settings, project);
  ctx.geminiBalancer = geminiBalancer;
  try {
    const identity = await pinQueryEmbeddingIdentity(ctx, signal);
    if (!identity) {
      return { ...health, state: "missing_runtime", identity: null };
    }
    return {
      state: "ready",
      identity,
      config,
      providerConfigured: embedder.hasKeys,
    };
  } catch (err: unknown) {
    const code =
      err instanceof LocalEmbeddingClientError
        ? err.code
        : err instanceof Error
          ? err.message
          : "failed";
    let state: EmbeddingHealthCode = "failed";
    if (code === "AUTH_FAILURE" || code === "UNAUTHORIZED") state = "auth_failure";
    else if (code === "CONFIG_MISMATCH") state = "config_mismatch";
    else if (code === "NOT_READY" || code === "DEPENDENCY_MISSING" || code === "LOAD_FAILED") {
      state = "missing_runtime";
    }
    return { state, identity: null, config, providerConfigured: embedder.hasKeys };
  }
}
