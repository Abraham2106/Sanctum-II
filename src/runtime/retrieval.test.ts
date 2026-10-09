import { describe, expect, it, vi } from "vitest";
import { buildEffectiveReadScope } from "./permissions";
import type { KgExpanderPort, TracerPort, VectorIdentity, VectorStorePort } from "./ports";
import {
  isVerifiableStoreIdentity,
  parseMinSimilarityThreshold,
  retrieveContextChunks,
  vectorIdentitiesCompatible,
} from "./retrieval";

const identity: VectorIdentity = {
  embedModel: "gemini-embedding-2",
  dims: 3,
  projectId: "p1",
};

function makeStore(
  chunks: VectorStorePort["allChunks"],
  storeIdentity: VectorIdentity | null = identity,
): VectorStorePort {
  return {
    count: chunks().length,
    identity: storeIdentity === null ? undefined : storeIdentity,
    allChunks: chunks,
  };
}

describe("retrieval (DEC-0022)", () => {
  it("vector identity mismatch skips retrieval", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const store = makeStore(() => [
      {
        id: "1",
        notePath: "Research/a.md",
        chunkText: "a",
        embedding: [1, 0, 0],
      },
    ]);
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: { embedModel: "other-model", dims: 3, projectId: "p1" },
      store,
      scope,
      topK: 5,
      minSimilarity: 0.1,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.skipReason).toBe("identity_mismatch");
  });

  it("nonempty store without verifiable identity yields rebuild_required", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const store = makeStore(
      () => [
        {
          id: "1",
          notePath: "Research/a.md",
          chunkText: "a",
          embedding: [1, 0, 0],
        },
      ],
      null,
    );
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: identity,
      store,
      scope,
      topK: 5,
      minSimilarity: 0.1,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.skipReason).toBe("rebuild_required");
  });

  it("enforces threshold without fallback (NaN scores never pass)", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const store = makeStore(() => [
      {
        id: "1",
        notePath: "Research/a.md",
        chunkText: "a",
        embedding: [0, 1, 0],
      },
    ]);
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: identity,
      store,
      scope,
      topK: 5,
      minSimilarity: 0.99,
    });
    expect(result.chunks).toHaveLength(0);
  });

  it("KG denied neighbor is excluded from results and traces", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/Research/**"],
      agentReadPaths: ["/**"],
    });
    const store = makeStore(() => [
      {
        id: "1",
        notePath: "Research/seed.md",
        chunkText: "seed",
        embedding: [1, 0, 0],
      },
    ]);
    const kg: KgExpanderPort = {
      enabled: true,
      edgeCount: 1,
      expandFromSeeds: () => ({
        added_chunks: [
          {
            note_path: "Finanzas/denied.md",
            chunk_text: "leak",
            score: 0.95,
            relation: "semantic",
          },
        ],
      }),
    };
    const tracer: TracerPort = { addChunk: vi.fn() };
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: identity,
      store,
      scope,
      topK: 5,
      minSimilarity: 0.1,
      kg,
      traceId: "t1",
      tracer,
    });
    expect(result.chunks.every((c) => c.notePath.startsWith("Research/"))).toBe(true);
    expect(result.chunks.some((c) => c.notePath.includes("Finanzas"))).toBe(false);
    const traceCalls = (tracer.addChunk as ReturnType<typeof vi.fn>).mock.calls;
    expect(traceCalls.every((c) => !String(c[1].from_note).includes("Finanzas"))).toBe(true);
  });

  it("invalid threshold fails closed (no fallback to 1)", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const store = makeStore(() => [
      {
        id: "1",
        notePath: "Research/a.md",
        chunkText: "a",
        embedding: [1, 0, 0],
      },
    ]);
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: identity,
      store,
      scope,
      topK: 5,
      minSimilarity: Number.NaN,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.skipReason).toBe("invalid_threshold");
    expect(parseMinSimilarityThreshold(Number.NaN)).toBeNull();
  });

  it("invalid topK yields empty results", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const store = makeStore(() => [
      {
        id: "1",
        notePath: "Research/a.md",
        chunkText: "a",
        embedding: [1, 0, 0],
      },
    ]);
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: identity,
      store,
      scope,
      topK: -1,
      minSimilarity: 0.1,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.skipReason).toBe("invalid_top_k");
  });

  it("vectorIdentitiesCompatible requires exact model, dims, and matching projectId", () => {
    const base = {
      embedModel: "gemini-embedding-2",
      dims: 768,
      projectId: "proj-a",
    };
    expect(vectorIdentitiesCompatible(base, { ...base })).toBe(true);
    expect(
      vectorIdentitiesCompatible(base, { ...base, embedModel: "gemini-embedding-001" }),
    ).toBe(false);
    expect(vectorIdentitiesCompatible(base, { ...base, projectId: "proj-b" })).toBe(false);
    expect(vectorIdentitiesCompatible({ ...base, projectId: "" }, base)).toBe(false);
    expect(vectorIdentitiesCompatible(base, { ...base, projectId: "   " })).toBe(false);
  });

  it("vectorIdentitiesCompatible enforces configFingerprint when store sealed it", () => {
    const base = {
      embedModel: "google/embeddinggemma-2",
      dims: 768,
      projectId: "proj-a",
      configFingerprint: "abc123",
    };
    expect(vectorIdentitiesCompatible(base, { ...base })).toBe(true);
    expect(
      vectorIdentitiesCompatible(base, { ...base, configFingerprint: "other" }),
    ).toBe(false);
    expect(vectorIdentitiesCompatible(base, { ...base, configFingerprint: undefined })).toBe(
      false,
    );
  });

  it("isVerifiableStoreIdentity requires nonempty projectId", () => {
    const ok: VectorIdentity = {
      embedModel: "m",
      dims: 3,
      projectId: "p1",
    };
    expect(isVerifiableStoreIdentity(ok)).toBe(true);
    expect(isVerifiableStoreIdentity({ ...ok, projectId: undefined })).toBe(false);
    expect(isVerifiableStoreIdentity({ ...ok, projectId: "" })).toBe(false);
    expect(isVerifiableStoreIdentity({ ...ok, projectId: "  " })).toBe(false);
  });

  it("retrieveContextChunks rejects missing query projectId before allChunks/KG/traces", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const allChunks = vi.fn(() => [
      {
        id: "1",
        notePath: "Research/a.md",
        chunkText: "a",
        embedding: [1, 0, 0],
      },
    ]);
    const expandFromSeeds = vi.fn();
    const addChunk = vi.fn();
    const store: VectorStorePort = { count: 1, identity, allChunks };
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: { embedModel: identity.embedModel, dims: identity.dims },
      store,
      scope,
      topK: 5,
      minSimilarity: 0.1,
      kg: { enabled: true, edgeCount: 1, expandFromSeeds },
      traceId: "t1",
      tracer: { addChunk },
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.skipReason).toBe("identity_mismatch");
    expect(allChunks).not.toHaveBeenCalled();
    expect(expandFromSeeds).not.toHaveBeenCalled();
    expect(addChunk).not.toHaveBeenCalled();
  });

  it("retrieveContextChunks rejects missing store projectId before allChunks", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const allChunks = vi.fn(() => [
      {
        id: "1",
        notePath: "Research/a.md",
        chunkText: "a",
        embedding: [1, 0, 0],
      },
    ]);
    const store: VectorStorePort = {
      count: 1,
      identity: { embedModel: identity.embedModel, dims: identity.dims },
      allChunks,
    };
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: identity,
      store,
      scope,
      topK: 5,
      minSimilarity: 0.1,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.skipReason).toBe("rebuild_required");
    expect(allChunks).not.toHaveBeenCalled();
  });

  it("retrieveContextChunks rejects wrong project before allChunks/KG/traces", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const allChunks = vi.fn(() => [
      {
        id: "1",
        notePath: "Research/a.md",
        chunkText: "a",
        embedding: [1, 0, 0],
      },
    ]);
    const expandFromSeeds = vi.fn();
    const store: VectorStorePort = {
      count: 1,
      identity: { ...identity, projectId: "other-project" },
      allChunks,
    };
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: identity,
      store,
      scope,
      topK: 5,
      minSimilarity: 0.1,
      kg: { enabled: true, edgeCount: 1, expandFromSeeds },
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.skipReason).toBe("identity_mismatch");
    expect(allChunks).not.toHaveBeenCalled();
    expect(expandFromSeeds).not.toHaveBeenCalled();
  });

  it("retrieveContextChunks authorizes same exact project identity", () => {
    const scope = buildEffectiveReadScope({
      projectReadPaths: ["/**"],
      agentReadPaths: ["/**"],
    });
    const store = makeStore(() => [
      {
        id: "1",
        notePath: "Research/a.md",
        chunkText: "authorized chunk",
        embedding: [1, 0, 0],
      },
    ]);
    const result = retrieveContextChunks({
      queryEmbedding: [1, 0, 0],
      queryIdentity: identity,
      store,
      scope,
      topK: 5,
      minSimilarity: 0.1,
    });
    expect(result.skipReason).toBeUndefined();
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].chunkText).toBe("authorized chunk");
  });
});
