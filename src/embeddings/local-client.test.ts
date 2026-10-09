import { describe, expect, it, vi } from "vitest";
import { buildLocalIdentity } from "./embedding-identity";
import { LocalEmbeddingClient, LocalEmbeddingClientError } from "./local-client";
import type { LoopbackHttpTransport } from "./local-node-transport";

const REV = "abcdef0123456789abcdef0123456789abcdef01";

const RUNTIME = {
  python: "3.12.0",
  torch: "2.5.0",
  transformers: "4.48.0",
  sentence_transformers: "3.3.0",
};

const identity = buildLocalIdentity(REV, 768, "cpu", "float32", RUNTIME);

function makeTransport(handler: (req: { method: string; path: string; body?: string }) => {
  status: number;
  body: string;
}): LoopbackHttpTransport {
  return async (request) => {
    const result = handler({
      method: request.method,
      path: request.path,
      body: request.body,
    });
    return { statusCode: result.status, headers: {}, body: result.body };
  };
}

describe("local-client (DEC-0023)", () => {
  it("surfaces auth failure from health", async () => {
    const client = new LocalEmbeddingClient({
      config: { localPort: 8767, localToken: "secret", dims: 768 },
      transport: makeTransport(() => ({ status: 401, body: '{"version":1,"error":{"code":"UNAUTHORIZED"}}' })),
    });
    await expect(client.health()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects redirect responses", async () => {
    const client = new LocalEmbeddingClient({
      config: { localPort: 8767, localToken: "secret", dims: 768 },
      transport: makeTransport(() => ({ status: 302, body: "" })),
    });
    await expect(client.health()).rejects.toMatchObject({ code: "REDIRECT_REJECTED" });
  });

  it("validates embed response identity and vectors", async () => {
    const client = new LocalEmbeddingClient({
      config: { localPort: 8767, localToken: "secret", dims: 768 },
      transport: makeTransport(({ method, path, body }) => {
        if (method === "GET" && path === "/health") {
          return {
            status: 200,
            body: JSON.stringify({ version: 1, state: "ready", identity }),
          };
        }
        if (method === "POST" && path === "/embed") {
          const parsed = JSON.parse(body ?? "{}");
          expect(parsed.texts[0]).toBe("task: search result | query: hello");
          return {
            status: 200,
            body: JSON.stringify({
              version: 1,
              identity,
              embeddings: [[0.1, 0.2, 0.3].concat(Array(765).fill(0.01))],
            }),
          };
        }
        return { status: 404, body: "{}" };
      }),
    });
    const vec = await client.embedOne("query", "hello", identity);
    expect(vec).toHaveLength(768);
  });

  it("surfaces token overflow errors from server without fallback", async () => {
    const client = new LocalEmbeddingClient({
      config: { localPort: 8767, localToken: "secret", dims: 768 },
      transport: makeTransport(({ method, path }) => {
        if (method === "GET") {
          return { status: 200, body: JSON.stringify({ version: 1, state: "ready", identity }) };
        }
        if (method === "POST") {
          return {
            status: 400,
            body: JSON.stringify({ version: 1, error: { code: "TOKEN_BUDGET_EXCEEDED" } }),
          };
        }
        return { status: 404, body: "{}" };
      }),
    });
    await expect(client.embedOne("query", "x", identity)).rejects.toMatchObject({
      code: "TOKEN_BUDGET_EXCEEDED",
    });
  });

  it("honours abort via transport", async () => {
    const controller = new AbortController();
    const transport: LoopbackHttpTransport = vi.fn(async (request) => {
      controller.abort();
      expect(request.signal?.aborted).toBe(true);
      throw new LocalEmbeddingClientError("ABORTED");
    });
    const client = new LocalEmbeddingClient({
      config: { localPort: 8767, localToken: "secret", dims: 768 },
      transport,
    });
    await expect(client.health(controller.signal)).rejects.toMatchObject({ code: "ABORTED" });
  });
});
