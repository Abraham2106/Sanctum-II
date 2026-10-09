import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../constants";
import { buildLocalIdentity } from "../embeddings/embedding-identity";
import { LocalEmbeddingClient, LocalEmbeddingClientError } from "../embeddings/local-client";
import type { LoopbackHttpTransport } from "../embeddings/local-node-transport";
import { createConfiguredEmbedderPort } from "./embedding";

const REV = "abcdef0123456789abcdef0123456789abcdef01";

const identity = buildLocalIdentity(REV, 768, "cpu", "float32", {
  python: "3.12.0",
  torch: "2.5.0",
  transformers: "4.48.0",
  sentence_transformers: "3.3.0",
});

describe("embedding runtime port (DEC-0023)", () => {
  it("does not fall back to Gemini when local backend fails", async () => {
    const geminiEmbed = vi.fn(async () => [1, 0, 0]);
    const transport: LoopbackHttpTransport = async () => ({
      statusCode: 503,
      headers: {},
      body: JSON.stringify({ version: 1, error: { code: "NOT_READY" } }),
    });
    const localClient = new LocalEmbeddingClient({
      config: { localPort: 8767, localToken: "tok", dims: 768 },
      transport,
    });
    const port = createConfiguredEmbedderPort({
      settings: {
        ...DEFAULT_SETTINGS,
        embeddingBackend: "sentence-transformers",
        localEmbeddingToken: "tok",
        localEmbeddingRevision: REV,
      },
      geminiBalancer: { hasKeys: true, embed: geminiEmbed } as never,
      localClient,
    });
    expect(port.hasKeys).toBe(true);
    await expect(port.embed("hello", { purpose: "query", expectedIdentity: identity })).rejects.toBeInstanceOf(
      LocalEmbeddingClientError,
    );
    expect(geminiEmbed).not.toHaveBeenCalled();
  });
});
