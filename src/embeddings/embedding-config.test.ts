import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../constants";
import { defaultProject } from "../projects/types";
import {
  isEmbeddingProviderConfigured,
  parseEmbeddingBackend,
  resolveEffectiveEmbeddingConfig,
  resolveGlobalEmbeddingConfig,
} from "./embedding-config";

const REV = "abcdef0123456789abcdef0123456789abcdef01";

describe("embedding-config (DEC-0023)", () => {
  it("defaults to gemini backend without inferring from model name", () => {
    expect(parseEmbeddingBackend(undefined)).toBe("gemini");
    expect(parseEmbeddingBackend("gemini")).toBe("gemini");
    expect(parseEmbeddingBackend("sentence-transformers")).toBe("sentence-transformers");
    expect(() => parseEmbeddingBackend("google/embeddinggemma-2")).toThrow();
  });

  it("hasKeys alias: gemini requires keys; local requires token+revision", () => {
    const gemini = resolveGlobalEmbeddingConfig({
      ...DEFAULT_SETTINGS,
      embeddingBackend: "gemini",
      geminiApiKeys: "k1",
    });
    expect(isEmbeddingProviderConfigured(gemini)).toBe(true);
    const local = resolveGlobalEmbeddingConfig({
      ...DEFAULT_SETTINGS,
      embeddingBackend: "sentence-transformers",
      localEmbeddingToken: "tok",
      localEmbeddingRevision: REV,
    });
    expect(isEmbeddingProviderConfigured(local)).toBe(true);
    expect(
      isEmbeddingProviderConfigured({
        ...local,
        geminiApiKeys: "",
        localToken: "",
      }),
    ).toBe(false);
  });

  it("project embedding overrides global backend selection", () => {
    const effective = resolveEffectiveEmbeddingConfig(
      { ...DEFAULT_SETTINGS, embeddingBackend: "gemini", geminiApiKeys: "k" },
      {
        ...defaultProject("p"),
        embedding: {
          backend: "sentence-transformers",
          model: "google/embeddinggemma-2",
          revision: REV,
          dims: 512,
        },
      },
    );
    expect(effective.backend).toBe("sentence-transformers");
    expect(effective.dims).toBe(512);
  });
});
