import { canonicalJsonString, configFingerprint } from "./embedding-identity-canonical";
import {
  ALLOWED_LOCAL_DIMS,
  DOCUMENT_PREFIX,
  LOCAL_BACKEND,
  LOCAL_MODEL_ID,
  MAX_TOKEN_BUDGET,
  PREPROCESS_MAX_UTF16,
  QUERY_PREFIX,
  type EmbeddingDescriptor,
  type EmbeddingIdentityDocument,
  type GeminiEmbeddingDescriptor,
  type LocalEmbeddingDescriptor,
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

const OUTER_IDENTITY_KEYS = new Set([
  "version",
  "backend",
  "model",
  "revision",
  "dims",
  "configFingerprint",
  "descriptor",
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

function geminiDescriptorSchemaValid(desc: unknown): desc is GeminiEmbeddingDescriptor {
  if (!desc || typeof desc !== "object") return false;
  const d = desc as GeminiEmbeddingDescriptor;
  if (d.backend !== "gemini") return false;
  if (typeof d.model !== "string" || d.revision !== "api") return false;
  if (typeof d.dims !== "number" || !Number.isInteger(d.dims) || d.dims <= 0) return false;
  if (d.runtime?.adapter !== "gemini-v1") return false;
  if (d.device !== "remote" || d.dtype !== "provider") return false;
  if (d.encoders.length !== 1 || d.encoders[0] !== "text") return false;
  if (d.tokenizerRevision !== "provider-managed") return false;
  if (d.queryPrefix !== "" || d.documentPrefix !== "") return false;
  if (d.normalize !== false) return false;
  if (d.preprocessing.overflow !== "provider" || d.preprocessing.maxTokens !== null) return false;
  return true;
}

export function descriptorSchemaValid(desc: unknown): desc is EmbeddingDescriptor {
  if (!desc || typeof desc !== "object") return false;
  const backend = (desc as { backend?: string }).backend;
  if (backend === LOCAL_BACKEND) return localDescriptorSchemaValid(desc);
  if (backend === "gemini") return geminiDescriptorSchemaValid(desc);
  return false;
}

export function identityDocumentValid(doc: unknown): doc is EmbeddingIdentityDocument {
  if (!doc || typeof doc !== "object") return false;
  const keys = Object.keys(doc as object);
  if (keys.length !== OUTER_IDENTITY_KEYS.size || !keys.every((k) => OUTER_IDENTITY_KEYS.has(k))) {
    return false;
  }
  const id = doc as EmbeddingIdentityDocument;
  if (id.version !== 1) return false;
  if (typeof id.dims !== "number" || !Number.isInteger(id.dims)) return false;
  for (const key of ["backend", "model", "revision", "configFingerprint"] as const) {
    if (typeof id[key] !== "string") return false;
  }
  if (!descriptorSchemaValid(id.descriptor)) return false;
  for (const key of ["backend", "model", "revision", "dims"] as const) {
    if (id.descriptor[key] !== id[key]) return false;
  }
  try {
    return configFingerprint(id.descriptor) === id.configFingerprint;
  } catch {
    return false;
  }
}

export function identitiesMatch(
  expected: EmbeddingIdentityDocument,
  actual: EmbeddingIdentityDocument,
): boolean {
  if (!identityDocumentValid(expected) || !identityDocumentValid(actual)) {
    return false;
  }
  for (const key of ["backend", "model", "revision", "configFingerprint"] as const) {
    if (expected[key] !== actual[key]) return false;
  }
  if (expected.dims !== actual.dims) return false;
  return canonicalJsonString(expected.descriptor) === canonicalJsonString(actual.descriptor);
}
