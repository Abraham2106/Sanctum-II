import { afterEach, describe, expect, it, vi } from "vitest"
import { embedText } from "./gemini-embed"

describe("MCP Gemini authentication", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(["AQ.auth-key.with-dots", "AIza-legacy-standard-key"])("sends an opaque %s key in x-goog-api-key, never in the URL", async key => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [0, 1] } }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(embedText("Ising test", key)).resolves.toEqual([0, 1])
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent")
    expect(url).not.toContain(key)
    expect(options.headers).toMatchObject({ "x-goog-api-key": key })
  })
})
