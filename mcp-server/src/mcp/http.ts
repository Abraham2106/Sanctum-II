// DEC-0020: Grok Bot usa el MCP por POST /mcp
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { McpServer } from "./server.js"
import type { JsonRpcRequest } from "./types.js"

// ponytail: sin allowlist de Origin; el bind es localhost. Subir cuando escuche en una interfaz pública.

// DEC-0021: el MCP anuncia el uso y lista notas
const MAX_POST_BODY_BYTES = 1048576

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

async function handlePostMcp(
  server: McpServer,
  req: IncomingMessage,
  res: ServerResponse,
  token?: string,
): Promise<void> {
  if (token) {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${token}`) {
      res.statusCode = 401
      res.end()
      return
    }
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

  if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
    res.statusCode = 400
    res.end()
    return
  }

  const obj = parsed as Record<string, unknown>
  if (typeof obj.method !== "string") {
    res.statusCode = 400
    res.end()
    return
  }

  const rpcReq = parsed as JsonRpcRequest
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

export function startMcpHttp(
  server: McpServer,
  opts: { port: number; host?: string; token?: string },
): Promise<{ port: number; close: () => Promise<void> }> {
  const host = opts.host ?? "127.0.0.1"
  if (host === "0.0.0.0") {
    return Promise.reject(new Error("bind en 0.0.0.0 no permitido"))
  }

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
          await handlePostMcp(server, req, res, opts.token)
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
