import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildLocalIdentity } from "./embedding-identity";
import { createLoopbackNodeTransport, LoopbackHttpError } from "./local-node-transport";

const REV = "abcdef0123456789abcdef0123456789abcdef01";

const identity = buildLocalIdentity(REV, 768, "cpu", "float32", {
  python: "3.12.0",
  torch: "2.5.0",
  transformers: "4.48.0",
  sentence_transformers: "3.3.0",
});

let server: http.Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe("local-node-transport (loopback)", () => {
  it("talks to a real 127.0.0.1 server and rejects redirects", async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(302, { Location: "/elsewhere" });
        res.end();
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server!.address() as { port: number }).port;
    const transport = createLoopbackNodeTransport();
    await expect(
      transport({
        method: "GET",
        path: "/health",
        port,
        headers: { Host: `127.0.0.1:${port}` },
        timeoutMs: 2000,
      }),
    ).rejects.toBeInstanceOf(LoopbackHttpError);
  });

  it("returns JSON body on successful health", async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/health") {
        const body = JSON.stringify({ version: 1, state: "ready", identity });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server!.address() as { port: number }).port;
    const transport = createLoopbackNodeTransport();
    const response = await transport({
      method: "GET",
      path: "/health",
      port,
      headers: { Host: `127.0.0.1:${port}` },
      timeoutMs: 2000,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).state).toBe("ready");
  });
});
