import { configFingerprint } from "./embedding-identity-canonical";
import {
  ALLOWED_LOCAL_DIMS,
  DOCUMENT_PREFIX,
  LOCAL_BACKEND,
  LOCAL_MODEL_ID,
  MAX_TOKEN_BUDGET,
  PREPROCESS_MAX_UTF16,
  QUERY_PREFIX,
  type EmbeddingIdentityDocument,
  type GeminiEmbeddingDescriptor,
  type LocalEmbeddingDescriptor,
  type LocalRuntimeVersions,
} from "./embedding-identity";

const LOCAL_DESCRIPTOR_KEYS = new Set([
  "backend",
  "model",
  "revision",
  "dims",
  "runtime",
  "device",
  "dtype",
  "encoders",
  "tokenizerRevision",
  "queryPrefix",
  "documentPrefix",
  "pooling",
  "projection",
  "normalize",
  "preprocessing",
]);

function localDescriptorSchemaValid(desc: unknown): desc is LocalEmbeddingDescriptor {
  if (!desc || typeof desc !== "object") return false;
  const keys = Object.keys(desc as object);
  if (keys.length !== LOCAL_DESCRIPTOR_KEYS.size || !keys.every((k) => LOCAL_DESCRIPTOR_KEYS.has(k))) {
    return false;
  }
  const d = desc as LocalEmbeddingDescriptor;
  if (d.backend !== LOCAL_BACKEND || d.model !== LOCAL_MODEL_ID) return false;
  if (typeof d.dims !== "number" || !Number.isInteger(d.dims)) return false;
  if (!(ALLOWED_LOCAL_DIMS as readonly number[]).includes(d.dims)) return false;
  if (d.revision !== d.tokenizerRevision) return false;
  if (d.revision.length !== 40) return false;
  if (d.device !== "cpu" && d.device !== "cuda") return false;
  if (d.dtype !== "float32" && d.dtype !== "bfloat16") return false;
  if (d.encoders.length !== 1 || d.encoders[0] !== "text") return false;
  if (d.queryPrefix !== QUERY_PREFIX || d.documentPrefix !== DOCUMENT_PREFIX) return false;
  if (d.pooling !== "model-default" || d.projection !== "model-default") return false;
  if (d.normalize !== true) return false;
  const prep = d.preprocessing;
  if (
    prep.maxChars !== PREPROCESS_MAX_UTF16 ||
    prep.units !== "utf16-code-units" ||
    prep.maxTokens !== MAX_TOKEN_BUDGET ||
    prep.overflow !== "reject"
  ) {
    return false;
  }
  const rt = d.runtime;
  const rtKeys = Object.keys(rt);
  if (
    rtKeys.length !== 4 ||
    typeof rt.python !== "string" ||
    typeof rt.torch !== "string" ||
    typeof rt.transformers !== "string" ||
    typeof rt.sentence_transformers !== "string"
  ) {
    return false;
  }
  return true;
}

export function validateRevisionString(revision: string): string {
  if (revision.length !== 40) throw new Error("INVALID_REVISION");
  if (revision !== revision.toLowerCase()) throw new Error("INVALID_REVISION");
  if (!/^[0-9a-f]+$/.test(revision)) throw new Error("INVALID_REVISION");
  return revision;
}

export function buildLocalDescriptor(
  revision: string,
  dims: number,
  device: "cpu" | "cuda",
  dtype: "float32" | "bfloat16",
  runtime: LocalRuntimeVersions,
): LocalEmbeddingDescriptor {
  const desc: LocalEmbeddingDescriptor = {
    backend: LOCAL_BACKEND,
    model: LOCAL_MODEL_ID,
    revision,
    dims,
    runtime: {
      python: runtime.python,
      torch: runtime.torch,
      transformers: runtime.transformers,
      sentence_transformers: runtime.sentence_transformers,
    },
    device,
    dtype,
    encoders: ["text"],
    tokenizerRevision: revision,
    queryPrefix: QUERY_PREFIX,
    documentPrefix: DOCUMENT_PREFIX,
    pooling: "model-default",
    projection: "model-default",
    normalize: true,
    preprocessing: {
      maxChars: PREPROCESS_MAX_UTF16,
      units: "utf16-code-units",
      maxTokens: MAX_TOKEN_BUDGET,
      overflow: "reject",
    },
  };
  if (!localDescriptorSchemaValid(desc)) {
    throw new Error("descriptor shape");
  }
  return desc;
}

export function buildLocalIdentity(
  revision: string,
  dims: number,
  device: "cpu" | "cuda",
  dtype: "float32" | "bfloat16",
  runtime: LocalRuntimeVersions,
): EmbeddingIdentityDocument {
  const descriptor = buildLocalDescriptor(revision, dims, device, dtype, runtime);
  return {
    version: 1,
    backend: LOCAL_BACKEND,
    model: LOCAL_MODEL_ID,
    revision,
    dims,
    configFingerprint: configFingerprint(descriptor),
    descriptor,
  };
}

export function buildGeminiDescriptor(model: string, dims: number): GeminiEmbeddingDescriptor {
  return {
    backend: "gemini",
    model,
    revision: "api",
    dims,
    runtime: { adapter: "gemini-v1" },
    device: "remote",
    dtype: "provider",
    encoders: ["text"],
    tokenizerRevision: "provider-managed",
    queryPrefix: "",
    documentPrefix: "",
    pooling: "model-default",
    projection: "model-default",
    normalize: false,
    preprocessing: {
      maxChars: PREPROCESS_MAX_UTF16,
      units: "utf16-code-units",
      maxTokens: null,
      overflow: "provider",
    },
  };
}

export function buildGeminiIdentity(model: string, dims: number): EmbeddingIdentityDocument {
  const descriptor = buildGeminiDescriptor(model, dims);
  return {
    version: 1,
    backend: "gemini",
    model,
    revision: "api",
    dims,
    configFingerprint: configFingerprint(descriptor),
    descriptor,
  };
}
