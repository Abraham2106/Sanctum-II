import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import {
  embedModelForVectorIdentity,
  isEmbeddingProviderConfigured,
  resolveEffectiveEmbeddingConfig,
  type EmbeddingEnvSlice,
  type ResolvedEmbeddingConfig,
} from "../embeddings/embedding-config";
import {
  buildGeminiIdentity,
  identityDocumentValid,
  type EmbeddingIdentityDocument,
  type EmbeddingPurpose,
} from "../embeddings/embedding-identity";
import { LocalEmbeddingClient, LocalEmbeddingClientError } from "../embeddings/local-client";
import type { SanctumSettings } from "../constants";
import type { Project } from "../projects/types";
import { bindEmbedderPort, type EmbedCallOptions, type EmbedderPort } from "./ports";

export interface EmbeddingRuntimeContext {
  settings: SanctumSettings;
  project?: Project;
  env?: EmbeddingEnvSlice;
  geminiBalancer?: GeminiBalancer;
  localClient?: LocalEmbeddingClient;
}

export function resolveRuntimeEmbeddingConfig(ctx: EmbeddingRuntimeContext): ResolvedEmbeddingConfig {
  return resolveEffectiveEmbeddingConfig(ctx.settings, ctx.project, ctx.env);
}

export function createLocalEmbeddingClient(config: ResolvedEmbeddingConfig): LocalEmbeddingClient {
  return new LocalEmbeddingClient({
    config: {
      localPort: config.localPort,
      localToken: config.localToken,
      dims: config.dims,
    },
  });
}

async function resolveLocalPinnedIdentity(
  client: LocalEmbeddingClient,
  config: ResolvedEmbeddingConfig,
  signal?: AbortSignal,
): Promise<EmbeddingIdentityDocument> {
  const health = await client.health(signal);
  if (health.state !== "ready" || !health.identity) {
    throw new LocalEmbeddingClientError(health.code ?? "NOT_READY");
  }
  const identity = health.identity;
  if (identity.backend !== config.backend) {
    throw new LocalEmbeddingClientError("CONFIG_MISMATCH");
  }
  if (identity.model !== config.model) {
    throw new LocalEmbeddingClientError("CONFIG_MISMATCH");
  }
  if (identity.revision !== config.revision) {
    throw new LocalEmbeddingClientError("CONFIG_MISMATCH");
  }
  if (identity.dims !== config.dims) {
    throw new LocalEmbeddingClientError("CONFIG_MISMATCH");
  }
  return identity;
}

async function embedWithLocal(
  client: LocalEmbeddingClient,
  config: ResolvedEmbeddingConfig,
  text: string,
  options?: EmbedCallOptions,
): Promise<{ vector: number[]; identity: EmbeddingIdentityDocument }> {
  const expected =
    options?.expectedIdentity && identityDocumentValid(options.expectedIdentity)
      ? options.expectedIdentity
      : await resolveLocalPinnedIdentity(client, config, options?.signal);
  const purpose: EmbeddingPurpose = options?.purpose ?? "query";
  const vector = await client.embedOne(purpose, text, expected, options?.signal);
  return { vector, identity: expected };
}

async function embedWithGemini(
  balancer: GeminiBalancer,
  text: string,
  model: string,
  dims: number,
): Promise<{ vector: number[]; identity: EmbeddingIdentityDocument }> {
  const vector = await balancer.embed(text);
  return { vector, identity: buildGeminiIdentity(model, dims) };
}

/** DEC-0023: shared embedder port; no remote fallback when local backend is selected. */
export function createConfiguredEmbedderPort(ctx: EmbeddingRuntimeContext): EmbedderPort {
  const config = resolveRuntimeEmbeddingConfig(ctx);
  const hasKeys = isEmbeddingProviderConfigured(config);
  const localClient =
    ctx.localClient ??
    (config.backend === "sentence-transformers" ? createLocalEmbeddingClient(config) : undefined);

  return {
    hasKeys,
    embed: async (text, options) => {
      if (config.backend === "sentence-transformers") {
        if (!localClient) {
          throw new LocalEmbeddingClientError("LOCAL_NOT_CONFIGURED");
        }
        const result = await embedWithLocal(localClient, config, text, options);
        return result.vector;
      }
      if (!ctx.geminiBalancer?.hasKeys) {
        throw new Error("No se configuraron GEMINI_API_KEYS");
      }
      const model = options?.model?.trim() || "gemini-embedding-2";
      const result = await embedWithGemini(ctx.geminiBalancer, text, model, config.dims);
      return result.vector;
    },
  };
}

/** Back-compat Gemini-only embedder until callers pass full runtime context. */
export function createDefaultEmbedderPort(balancer: GeminiBalancer): EmbedderPort {
  return bindEmbedderPort(balancer.hasKeys, (text) => balancer.embed(text));
}

export function vectorIdentityFromEmbeddingDoc(
  doc: EmbeddingIdentityDocument,
  projectId: string,
  projectRagModel: string,
  config: ResolvedEmbeddingConfig,
): {
  embedModel: string;
  dims: number;
  projectId: string;
  configFingerprint: string;
} {
  return {
    embedModel: embedModelForVectorIdentity(config, projectRagModel),
    dims: doc.dims,
    projectId: projectId.trim(),
    configFingerprint: doc.configFingerprint,
  };
}

export async function pinQueryEmbeddingIdentity(
  ctx: EmbeddingRuntimeContext,
  signal?: AbortSignal,
): Promise<EmbeddingIdentityDocument | null> {
  const config = resolveRuntimeEmbeddingConfig(ctx);
  if (config.backend !== "sentence-transformers") {
    const model = ctx.project?.rag.embed_model?.trim() || "gemini-embedding-2";
    return buildGeminiIdentity(model, config.dims);
  }
  const client = ctx.localClient ?? createLocalEmbeddingClient(config);
  try {
    return await resolveLocalPinnedIdentity(client, config, signal);
  } catch {
    return null;
  }
}
