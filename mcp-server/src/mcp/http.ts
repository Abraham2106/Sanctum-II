// DEC-0020: Grok Bot usa el MCP por POST /mcp
// DEC-0022: bind loopback estricto, token obligatorio, Origin exact allowlist, JSON-RPC 2.0
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { McpServer } from "./server.js"
import type { JsonRpcRequest } from "./types.js"

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"])

/** Límite de cuerpo POST según DEC-0022. */
const MAX_POST_BODY_BYTES = 1048576

/** Opciones públicas de {@link startMcpHttp}. */
export interface McpHttpListenOptions {
  /** Puerto TCP; `0` elige uno libre. */
  port: number
  /**
   * Dirección de bind; solo loopback (DEC-0022): `127.0.0.1`, `::1` o `localhost`.
   * Por defecto `127.0.0.1`.
   */
  host?: string
  /**
   * Token bearer; debe ser no vacío en el arranque o {@link startMcpHttp} rechaza (DEC-0022).
   */
  token?: string
  /**
   * Lista exacta de valores del encabezado `Origin` permitidos para clientes web.
   * Si `Origin` está ausente, se permite cliente nativo con bearer válido.
   * `Origin: null`, inválido u otro valor devuelve 403 aunque el bearer sea correcto.
   */
  allowedOrigins?: string[]
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let stopped = false

    const onData = (chunk: Buffer) => {
      if (stopped) return
      total += chunk.length
      if (total > MAX_POST_BODY_BYTES) {
        stopped = true
        req.removeListener("data", onData)
        req.on("data", () => {})
        req.resume()
        reject(new Error("BODY_TOO_LARGE"))
        return
      }
      chunks.push(chunk)
    }

    req.on("data", onData)
    req.on("end", () => {
      if (!stopped) resolve(Buffer.concat(chunks).toString("utf8"))
    })
    req.on("error", (err) => {
      if (!stopped) reject(err)
    })
  })
}

function wantsEventStream(accept: string | undefined): boolean {
  if (!accept) return true
  return accept.includes("text/event-stream")
}

function isOriginAllowed(
  originHeader: string | undefined,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  if (originHeader === undefined) return true
  if (originHeader === "null" || originHeader === "") return false
  if (!allowedOrigins || allowedOrigins.length === 0) return false
  return allowedOrigins.includes(originHeader)
}

function isStructuredParams(value: unknown): boolean {
  return value === null || typeof value === "object"
}

/** Valida forma de solicitud JSON-RPC 2.0 antes de despachar (DEC-0022). */
export function validateJsonRpcRequest(parsed: unknown): JsonRpcRequest | null {
  if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
    return null
  }
  const obj = parsed as Record<string, unknown>
  if (obj.jsonrpc !== "2.0") return null
  if (typeof obj.method !== "string" || obj.method.length === 0) return null
  if ("id" in obj) {
    const id = obj.id
    if (id !== null && typeof id !== "string" && typeof id !== "number") return null
  }
  if ("params" in obj && !isStructuredParams(obj.params)) return null
  return parsed as JsonRpcRequest
}

async function handlePostMcp(
  server: McpServer,
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  allowedOrigins: readonly string[] | undefined,
): Promise<void> {
  if (!isOriginAllowed(req.headers.origin, allowedOrigins)) {
    res.statusCode = 403
    res.end()
    return
  }

  const auth = req.headers.authorization
  if (auth !== `Bearer ${token}`) {
    res.statusCode = 401
    res.end()
    return
  }

  let raw: string
  try {
    raw = await readBody(req)
  } catch (err) {
    if (err instanceof Error && err.message === "BODY_TOO_LARGE") {
      res.statusCode = 413
      res.end(() => {
        req.destroy()
      })
      return
    }
    res.statusCode = 400
    res.end()
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    res.statusCode = 400
    res.end()
    return
  }

  const rpcReq = validateJsonRpcRequest(parsed)
  if (rpcReq === null) {
    res.statusCode = 400
    res.end()
    return
  }

  const response = await server.handleMessage(rpcReq)

  if (response === null) {
    res.statusCode = 202
    res.end()
    return
  }

  if (wantsEventStream(req.headers.accept)) {
    res.statusCode = 200
    res.setHeader("Content-Type", "text/event-stream")
    res.end(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
    return
  }

  res.statusCode = 200
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(response))
}

/**
 * Arranca el transporte HTTP MCP en `/mcp` (DEC-0022).
 *
 * @throws si el token falta o está vacío, o si `host` no es loopback permitido.
 */
export function startMcpHttp(
  server: McpServer,
  opts: McpHttpListenOptions,
): Promise<{ port: number; close: () => Promise<void> }> {
  if (typeof opts.token !== "string" || opts.token.length === 0) {
    return Promise.reject(new Error("token HTTP obligatorio y no vacío (DEC-0022)"))
  }

  const host = opts.host ?? "127.0.0.1"
  if (!LOOPBACK_HOSTS.has(host)) {
    return Promise.reject(new Error(`bind loopback no permitido: ${host} (DEC-0022)`))
  }

  const token = opts.token
  const allowedOrigins = opts.allowedOrigins

  return new Promise((resolve, reject) => {
    const httpServer = createServer((req, res) => {
      void (async () => {
        const path = (req.url ?? "").split("?")[0]

        if (path === "/mcp" && req.method === "GET") {
          res.statusCode = 405
          res.end()
          return
        }

        if (path === "/mcp" && req.method === "POST") {
          await handlePostMcp(server, req, res, token, allowedOrigins)
          return
        }

        res.statusCode = 404
        res.end()
      })().catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500
          res.end()
        }
      })
    })

    httpServer.once("error", reject)
    httpServer.listen(opts.port, host, () => {
      const addr = httpServer.address()
      const port =
        typeof addr === "object" && addr !== null ? addr.port : opts.port
      resolve({
        port,
        close: () =>
          new Promise((res, rej) => {
            httpServer.close((err) => (err ? rej(err) : res()))
          }),
      })
    })
  })
}
