import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));

vi.mock("obsidian", () => ({ requestUrl: requestUrlMock }));

import { GeminiBalancer } from "./gemini-balancer";

function successfulEmbeddingResponse() {
  const text = JSON.stringify({ embedding: { values: [1, 0, 0] } });
  return { status: 200, text, arrayBuffer: new TextEncoder().encode(text).buffer };
}

describe("GeminiBalancer authentication", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
    requestUrlMock.mockResolvedValue(successfulEmbeddingResponse());
  });

  it.each(["AQ.auth-key.with-dots", "AIza-legacy-standard-key"])("accepts an opaque %s key and sends it only as a header", async key => {
    const balancer = new GeminiBalancer(key);
    await expect(balancer.embed("QUBO test")).resolves.toEqual([1, 0, 0]);

    const request = requestUrlMock.mock.calls[0][0];
    expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent");
    expect(request.url).not.toContain(key);
    expect(request.headers).toMatchObject({ "x-goog-api-key": key });
  });
});
