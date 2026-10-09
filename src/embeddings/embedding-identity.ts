import { createHash } from "node:crypto";

/** DEC-0023: frozen local descriptor keys (must match local-embeddings/identity.py). */
export const LOCAL_BACKEND = "sentence-transformers" as const;
export const LOCAL_MODEL_ID = "google/embeddinggemma-2";
export const QUERY_PREFIX = "task: search result | query: ";
export const DOCUMENT_PREFIX = "title: none | text: ";
export const ALLOWED_LOCAL_DIMS = [768, 512, 256, 128] as const;
export const MAX_TOKEN_BUDGET = 8192;
export const PREPROCESS_MAX_UTF16 = 3000;

export type EmbeddingPurpose = "query" | "document";

export type LocalRuntimeVersions = {
  python: string;
  torch: string;
  transformers: string;
  sentence_transformers: string;
};

export type LocalPreprocessing = {
  maxChars: number;
  units: "utf16-code-units";
  maxTokens: number;
  overflow: "reject";
};

export type LocalEmbeddingDescriptor = {
  backend: typeof LOCAL_BACKEND;
  model: typeof LOCAL_MODEL_ID;
  revision: string;
  dims: number;
  runtime: LocalRuntimeVersions;
  device: "cpu" | "cuda";
  dtype: "float32" | "bfloat16";
  encoders: ["text"];
  tokenizerRevision: string;
  queryPrefix: typeof QUERY_PREFIX;
  documentPrefix: typeof DOCUMENT_PREFIX;
  pooling: "model-default";
  projection: "model-default";
  normalize: true;
  preprocessing: LocalPreprocessing;
};

export type GeminiEmbeddingDescriptor = {
  backend: "gemini";
  model: string;
  revision: "api";
  dims: number;
  runtime: { adapter: "gemini-v1" };
  device: "remote";
  dtype: "provider";
  encoders: ["text"];
  tokenizerRevision: "provider-managed";
  queryPrefix: "";
  documentPrefix: "";
  pooling: "model-default";
  projection: "model-default";
  normalize: false;
  preprocessing: {
    maxChars: number;
    units: "utf16-code-units";
    maxTokens: null;
    overflow: "provider";
  };
};

export type EmbeddingDescriptor = LocalEmbeddingDescriptor | GeminiEmbeddingDescriptor;

export type EmbeddingIdentityDocument = {
  version: 1;
  backend: string;
  model: string;
  revision: string;
  dims: number;
  configFingerprint: string;
  descriptor: EmbeddingDescriptor;
};

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

export function canonicalJsonBytes(obj: unknown): Buffer {
  return Buffer.from(canonicalJsonString(obj), "utf-8");
}

export function canonicalJsonString(obj: unknown): string {
  return JSON.stringify(sortDeep(obj));
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortDeep(record[key]);
  }
  return sorted;
}

export function configFingerprint(descriptor: EmbeddingDescriptor): string {
  return createHash("sha256").update(canonicalJsonBytes(descriptor)).digest("hex");
}

export function validateRevisionString(revision: string): string {
  if (revision.length !== 40) throw new Error("INVALID_REVISION");
  if (revision !== revision.toLowerCase()) throw new Error("INVALID_REVISION");
  if (!/^[0-9a-f]+$/.test(revision)) throw new Error("INVALID_REVISION");
  return revision;
}

export function purposePrefix(purpose: EmbeddingPurpose): string {
  if (purpose === "query") return QUERY_PREFIX;
  if (purpose === "document") return DOCUMENT_PREFIX;
  throw new Error("INVALID_PURPOSE");
}

export function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i += 1;
      continue;
    }
    if (cp >= 0xdc00 && cp <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function truncateUtf16CodeUnits(text: string, maxUnits: number = PREPROCESS_MAX_UTF16): string {
  if (hasLoneSurrogate(text)) {
    throw new Error("INVALID_TEXT");
  }
  let units = 0;
  let end = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const cost = cp > 0xffff ? 2 : 1;
    if (units + cost > maxUnits) {
      break;
    }
    units += cost;
    i += cp > 0xffff ? 2 : 1;
    end = i;
  }
  return text.slice(0, end);
}

export function prepareEmbeddingText(raw: string, purpose: EmbeddingPurpose): string {
  const truncated = truncateUtf16CodeUnits(raw);
  return `${purposePrefix(purpose)}${truncated}`;
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

export function vectorNorm(values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v * v;
  }
  return Math.sqrt(sum);
}

export function validateEmbeddingVector(values: unknown, dims: number): values is number[] {
  if (!Array.isArray(values) || values.length !== dims) return false;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  if (vectorNorm(values) === 0) return false;
  return true;
}

export function validateEmbeddingBatch(
  embeddings: unknown,
  expectedCount: number,
  dims: number,
): embeddings is number[][] {
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) return false;
  for (const row of embeddings) {
    if (!validateEmbeddingVector(row, dims)) return false;
  }
  return true;
}
