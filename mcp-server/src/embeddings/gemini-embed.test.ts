import { afterEach, describe, expect, it, vi } from "vitest"
import { PRIORITY_MODELS } from "../../../src/embeddings/embed-contract.js"
import { embedText } from "./gemini-embed.js"

describe("embedText (DEC-0011)", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("retries the next key on 429 and returns the second key embedding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ embedding: { values: [0.1, 0.2] } }),
      })
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const result = await embedText("hello", "k1,k2")
      expect(result).toEqual([0.1, 0.2])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const secondUrl = String(fetchMock.mock.calls[1][0])
      expect(secondUrl).toContain("key=k2")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("throws on non-retryable status without trying another key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    globalThis.fetch = fetchMock as typeof fetch

    try {
      await expect(embedText("hello", "k1,k2")).rejects.toThrow(/500/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("skips to the next model on 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ embedding: { values: [0.3, 0.4] } }),
      })
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const result = await embedText("hello", "k1")
      expect(result).toEqual([0.3, 0.4])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const secondUrl = String(fetchMock.mock.calls[1][0])
      expect(secondUrl).toContain(PRIORITY_MODELS[1])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
