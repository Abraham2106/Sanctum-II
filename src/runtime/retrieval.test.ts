import { describe, expect, it, vi } from "vitest";
import { buildEffectiveReadScope } from "./permissions";
import type { KgExpanderPort, TracerPort, VectorStorePort } from "./ports";
import {
  retrieveContextChunks,
  vectorIdentitiesCompatible,
} from "./retrieval";

const identity = { embedModel: "gemini-embedding-2", dims: 3 };

function makeStore(chunks: VectorStorePort["allChunks"]): VectorStorePort {
  return {
    count: chunks().length,
    identity,
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
      queryIdentity: { embedModel: "other-model", dims: 3 },
      store,
      scope,
      topK: 5,
      minSimilarity: 0.1,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.skipReason).toBe("identity_mismatch");
  });

  it("enforces threshold without fallback", () => {
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

  it("vectorIdentitiesCompatible requires exact model and dims", () => {
    expect(
      vectorIdentitiesCompatible(
        { embedModel: "gemini-embedding-2", dims: 768 },
        { embedModel: "gemini-embedding-2", dims: 768 },
      ),
    ).toBe(true);
    expect(
      vectorIdentitiesCompatible(
        { embedModel: "gemini-embedding-2", dims: 768 },
        { embedModel: "gemini-embedding-001", dims: 768 },
      ),
    ).toBe(false);
  });
});
