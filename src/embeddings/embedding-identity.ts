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

export {
  canonicalJsonBytes,
  canonicalJsonString,
  configFingerprint,
} from "./embedding-identity-canonical";

export {
  hasLoneSurrogate,
  prepareEmbeddingText,
  purposePrefix,
  truncateUtf16CodeUnits,
} from "./embedding-identity-preprocess";

export {
  buildGeminiDescriptor,
  buildGeminiIdentity,
  buildLocalDescriptor,
  buildLocalIdentity,
  validateRevisionString,
} from "./embedding-identity-builders";

export {
  descriptorSchemaValid,
  identitiesMatch,
  identityDocumentValid,
} from "./embedding-identity-schema";

export {
  validateEmbeddingBatch,
  validateEmbeddingVector,
  vectorNorm,
} from "./embedding-identity-vector";
