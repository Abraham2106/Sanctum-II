import type { ResolvedEmbeddingConfig } from "./embedding-config";
import { EMBED_DEFAULT_TIMEOUT_MS, HEALTH_TIMEOUT_MS } from "./embedding-config";
import {
  identityDocumentValid,
  identitiesMatch,
  prepareEmbeddingText,
  validateEmbeddingBatch,
  type EmbeddingIdentityDocument,
  type EmbeddingPurpose,
} from "./embedding-identity";
import {
  createLoopbackNodeTransport,
  LoopbackHttpError,
  type LoopbackHttpTransport,
} from "./local-node-transport";

export type LocalHealthState = "unconfigured" | "loading" | "ready" | "failed";

export interface LocalHealthResponse {
  version: 1;
  state: LocalHealthState;
  code?: string;
  identity?: EmbeddingIdentityDocument;
}

export class LocalEmbeddingClientError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "LocalEmbeddingClientError";
    this.code = code;
  }
}

export interface LocalEmbeddingClientOptions {
  config: Pick<ResolvedEmbeddingConfig, "localPort" | "localToken" | "dims">;
  transport?: LoopbackHttpTransport;
  healthTimeoutMs?: number;
  embedTimeoutMs?: number;
}

export class LocalEmbeddingClient {
  private readonly port: number;
  private readonly token: string;
  private readonly dims: number;
  private readonly transport: LoopbackHttpTransport;
  private readonly healthTimeoutMs: number;
  private readonly embedTimeoutMs: number;

  constructor(options: LocalEmbeddingClientOptions) {
    this.port = options.config.localPort;
    this.token = options.config.localToken;
    this.dims = options.config.dims;
    this.transport = options.transport ?? createLoopbackNodeTransport();
    this.healthTimeoutMs = options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    this.embedTimeoutMs = options.embedTimeoutMs ?? EMBED_DEFAULT_TIMEOUT_MS;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Host: `127.0.0.1:${this.port}`,
      Accept: "application/json",
    };
  }

  private parseJson(body: string): unknown {
    try {
      return JSON.parse(body);
    } catch {
      throw new LocalEmbeddingClientError("INVALID_JSON");
    }
  }

  async health(signal?: AbortSignal): Promise<LocalHealthResponse> {
    const response = await this.transport({
      method: "GET",
      path: "/health",
      port: this.port,
      headers: this.authHeaders(),
      timeoutMs: this.healthTimeoutMs,
      signal,
    });
    if (response.statusCode === 401) {
      throw new LocalEmbeddingClientError("UNAUTHORIZED");
    }
    if (response.statusCode === 403) {
      throw new LocalEmbeddingClientError("FORBIDDEN");
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw new LocalEmbeddingClientError("REDIRECT_REJECTED");
    }
    if (response.statusCode !== 200) {
      throw new LocalEmbeddingClientError("HEALTH_FAILED", `status ${response.statusCode}`);
    }
    const doc = this.parseJson(response.body) as LocalHealthResponse;
    if (doc.version !== 1 || typeof doc.state !== "string") {
      throw new LocalEmbeddingClientError("INVALID_SCHEMA");
    }
    if (doc.identity && !identityDocumentValid(doc.identity)) {
      throw new LocalEmbeddingClientError("INVALID_IDENTITY");
    }
    return doc;
  }

  async embedTexts(
    purpose: EmbeddingPurpose,
    rawTexts: string[],
    expectedIdentity: EmbeddingIdentityDocument,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (!identityDocumentValid(expectedIdentity)) {
      throw new LocalEmbeddingClientError("INVALID_IDENTITY");
    }
    const prepared = rawTexts.map((text) => prepareEmbeddingText(text, purpose));
    const payload = {
      version: 1 as const,
      purpose,
      texts: prepared,
      dims: this.dims,
      identity: expectedIdentity,
    };
    const response = await this.transport({
      method: "POST",
      path: "/embed",
      port: this.port,
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
      timeoutMs: this.embedTimeoutMs,
      signal,
    });
    if (response.statusCode === 401) {
      throw new LocalEmbeddingClientError("UNAUTHORIZED");
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw new LocalEmbeddingClientError("REDIRECT_REJECTED");
    }
    const doc = this.parseJson(response.body) as {
      version?: number;
      identity?: EmbeddingIdentityDocument;
      embeddings?: unknown;
      error?: { code?: string };
    };
    if (response.statusCode !== 200) {
      const code = doc.error?.code ?? "EMBED_FAILED";
      throw new LocalEmbeddingClientError(code);
    }
    if (doc.version !== 1 || !doc.identity || !doc.embeddings) {
      throw new LocalEmbeddingClientError("INVALID_SCHEMA");
    }
    if (!identityDocumentValid(doc.identity)) {
      throw new LocalEmbeddingClientError("INVALID_IDENTITY");
    }
    if (!identitiesMatch(expectedIdentity, doc.identity)) {
      throw new LocalEmbeddingClientError("IDENTITY_MISMATCH");
    }
    if (!validateEmbeddingBatch(doc.embeddings, prepared.length, this.dims)) {
      throw new LocalEmbeddingClientError("INVALID_VECTORS");
    }
    return doc.embeddings;
  }

  async embedOne(
    purpose: EmbeddingPurpose,
    rawText: string,
    expectedIdentity: EmbeddingIdentityDocument,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const batch = await this.embedTexts(purpose, [rawText], expectedIdentity, signal);
    return batch[0]!;
  }
}

export { LoopbackHttpError };
