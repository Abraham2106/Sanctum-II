import { describe, it, expect, afterEach } from "vitest"
import http from "node:http"
import { McpServer } from "./server.js"
import { startMcpHttp } from "./http.js"

function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        )
      },
    )
    req.on("error", reject)
    req.write(data)
    req.end()
  })
}

function postRaw(
  port: number,
  path: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        )
      },
    )
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        )
      })
      .on("error", reject)
  })
}

describe("startMcpHttp", () => {
  let close: (() => Promise<void>) | undefined
  let port = 0

  afterEach(async () => {
    if (close) await close()
    close = undefined
  })

  function makeServer(): McpServer {
    const server = new McpServer({ name: "test-mcp", version: "0.0.1" })
    server.registerTool({
      name: "echo_test",
      description: "tool de prueba",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    })
    return server
  }

  async function start(token?: string): Promise<void> {
    const server = makeServer()
    const h = await startMcpHttp(server, { port: 0, host: "127.0.0.1", token })
    port = h.port
    close = h.close
  }

  it("initialize 2025-03-26 con SSE devuelve esa versión", async () => {
    await start()
    const res = await post(
      port,
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      },
      { Accept: "text/event-stream" },
    )
    expect(res.status).toBe(200)
    expect(res.body).toContain("event: message")
    expect(res.body).toContain("2025-03-26")
  })

  it("tools/list devuelve echo_test", async () => {
    await start()
    const res = await post(
      port,
      "/mcp",
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { Accept: "application/json" },
    )
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as { result: { tools: { name: string }[] } }
    expect(json.result.tools.map((t) => t.name)).toContain("echo_test")
  })

  it("initialize 2024-11-05 devuelve 2024-11-05", async () => {
    await start()
    const res = await post(
      port,
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 3,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      },
      { Accept: "application/json" },
    )
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as { result: { protocolVersion: string } }
    expect(json.result.protocolVersion).toBe("2024-11-05")
  })

  it("GET /mcp es 405 y POST /otra es 404", async () => {
    await start()
    const getRes = await get(port, "/mcp")
    expect(getRes.status).toBe(405)
    const postRes = await post(port, "/otra", { jsonrpc: "2.0", id: 1, method: "ping" })
    expect(postRes.status).toBe(404)
  })

  it("con token, sin Authorization es 401 y Bearer correcto es 200", async () => {
    await start("secret-token")
    const unauthorized = await post(
      port,
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "ping" },
    )
    expect(unauthorized.status).toBe(401)
    const authorized = await post(
      port,
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { Authorization: "Bearer secret-token" },
    )
    expect(authorized.status).toBe(200)
  })

  it("notificación sin id responde 202 vacío", async () => {
    await start()
    const res = await post(port, "/mcp", {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })
    expect(res.status).toBe(202)
    expect(res.body).toBe("")
  })

  it("POST /mcp con cuerpo mayor a 1 MiB responde 413", async () => {
    await start()
    const res = await postRaw(port, "/mcp", Buffer.alloc(1048577))
    expect(res.status).toBe(413)
  })
})
