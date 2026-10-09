import { describe, it, expect, afterEach, vi } from "vitest"
import http from "node:http"
import { McpServer } from "./server.js"
import { startMcpHttp, validateJsonRpcRequest, isValidSerializedHttpOrigin } from "./http.js"

const TEST_TOKEN = "secret-token"
const TEST_ORIGIN = "http://127.0.0.1:5173"

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
          Authorization: `Bearer ${TEST_TOKEN}`,
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
          Authorization: `Bearer ${TEST_TOKEN}`,
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

describe("validateJsonRpcRequest", () => {
  it("acepta solicitud JSON-RPC 2.0 válida", () => {
    expect(
      validateJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "ping" }),
    ).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" })
  })

  it("rechaza jsonrpc distinto de 2.0", () => {
    expect(validateJsonRpcRequest({ jsonrpc: "1.0", method: "ping" })).toBeNull()
  })

  it("rechaza id con tipo inválido", () => {
    expect(validateJsonRpcRequest({ jsonrpc: "2.0", id: {}, method: "ping" })).toBeNull()
  })

  it("rechaza id numérico no finito (p. ej. JSON 1e400)", () => {
    const parsed = JSON.parse('{"jsonrpc":"2.0","id":1e400,"method":"ping"}') as unknown
    expect(validateJsonRpcRequest(parsed)).toBeNull()
  })

  it("rechaza params null", () => {
    expect(
      validateJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "ping", params: null }),
    ).toBeNull()
  })
})

describe("isValidSerializedHttpOrigin", () => {
  it("acepta origen http(s) serializado exacto", () => {
    expect(isValidSerializedHttpOrigin(TEST_ORIGIN)).toBe(true)
    expect(isValidSerializedHttpOrigin("https://localhost:3000")).toBe(true)
  })

  it("rechaza basura, path, credenciales, query/hash y cadenas vacías", () => {
    expect(isValidSerializedHttpOrigin("not-a-url")).toBe(false)
    expect(isValidSerializedHttpOrigin(`${TEST_ORIGIN}/path`)).toBe(false)
    expect(isValidSerializedHttpOrigin("http://user:pass@127.0.0.1:5173")).toBe(false)
    expect(isValidSerializedHttpOrigin(`${TEST_ORIGIN}?q=1`)).toBe(false)
    expect(isValidSerializedHttpOrigin(`${TEST_ORIGIN}#frag`)).toBe(false)
    expect(isValidSerializedHttpOrigin("")).toBe(false)
    expect(isValidSerializedHttpOrigin("null")).toBe(false)
  })
})

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

  async function start(
    overrides: Partial<{
      token: string
      host: string
      allowedOrigins: string[]
    }> = {},
  ): Promise<void> {
    const server = makeServer()
    const h = await startMcpHttp(server, {
      port: 0,
      host: "127.0.0.1",
      token: TEST_TOKEN,
      allowedOrigins: [TEST_ORIGIN],
      ...overrides,
    })
    port = h.port
    close = h.close
  }

  it("rechaza arranque sin token o con token vacío", async () => {
    const server = makeServer()
    await expect(startMcpHttp(server, { port: 0 })).rejects.toThrow(/token HTTP obligatorio/)
    await expect(startMcpHttp(server, { port: 0, token: "" })).rejects.toThrow(
      /token HTTP obligatorio/,
    )
  })

  it("rechaza bind fuera de loopback permitido", async () => {
    const server = makeServer()
    await expect(
      startMcpHttp(server, { port: 0, token: TEST_TOKEN, host: "0.0.0.0" }),
    ).rejects.toThrow(/loopback/)
  })

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

  it("sin Authorization es 401 y Bearer correcto es 200", async () => {
    await start()
    const unauthorized = await post(
      port,
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { Authorization: "" },
    )
    expect(unauthorized.status).toBe(401)
    const authorized = await post(port, "/mcp", { jsonrpc: "2.0", id: 1, method: "ping" })
    expect(authorized.status).toBe(200)
  })

  it("Origin ausente permite cliente nativo autenticado", async () => {
    await start()
    const res = await post(port, "/mcp", { jsonrpc: "2.0", id: 1, method: "ping" })
    expect(res.status).toBe(200)
  })

  it("Origin en allowlist exacta con bearer es 200", async () => {
    await start()
    const res = await post(
      port,
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { Origin: TEST_ORIGIN },
    )
    expect(res.status).toBe(200)
  })

  it("Origin no listada devuelve 403 aunque el bearer sea correcto", async () => {
    await start()
    const res = await post(
      port,
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { Origin: "http://evil.example" },
    )
    expect(res.status).toBe(403)
  })

  it("Origin null devuelve 403 aunque el bearer sea correcto", async () => {
    await start()
    const res = await post(
      port,
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { Origin: "null" },
    )
    expect(res.status).toBe(403)
  })

  it("Origin inválido devuelve 403 aunque esté en allowedOrigins", async () => {
    const invalidListed = `${TEST_ORIGIN}/evil`
    await start({ allowedOrigins: [TEST_ORIGIN, invalidListed] })
    const res = await post(
      port,
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { Origin: invalidListed },
    )
    expect(res.status).toBe(403)
  })

  it("cuerpo JSON-RPC inválido responde 400 sin despachar", async () => {
    const server = makeServer()
    const handleSpy = vi.spyOn(server, "handleMessage")
    const h = await startMcpHttp(server, {
      port: 0,
      host: "127.0.0.1",
      token: TEST_TOKEN,
      allowedOrigins: [TEST_ORIGIN],
    })
    port = h.port
    close = h.close

    const res = await post(port, "/mcp", { jsonrpc: "1.0", id: 1, method: "ping" })
    expect(res.status).toBe(400)
    expect(handleSpy).not.toHaveBeenCalled()
    handleSpy.mockRestore()
  })

  it("params null y id no finito responden 400 sin despachar", async () => {
    const server = makeServer()
    const handleSpy = vi.spyOn(server, "handleMessage")
    const h = await startMcpHttp(server, {
      port: 0,
      host: "127.0.0.1",
      token: TEST_TOKEN,
      allowedOrigins: [TEST_ORIGIN],
    })
    port = h.port
    close = h.close

    const nullParams = await post(port, "/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: null,
    })
    expect(nullParams.status).toBe(400)

    const nonFiniteId = await postRaw(
      port,
      "/mcp",
      Buffer.from('{"jsonrpc":"2.0","id":1e400,"method":"ping"}', "utf8"),
    )
    expect(nonFiniteId.status).toBe(400)
    expect(handleSpy).not.toHaveBeenCalled()
    handleSpy.mockRestore()
  })

  it("cuerpo JSON-RPC inválido responde 400", async () => {
    await start()
    const res = await post(port, "/mcp", { jsonrpc: "1.0", id: 1, method: "ping" })
    expect(res.status).toBe(400)
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
