import { createInterface } from "node:readline"
import { log } from "./logger.js"
import type { JsonRpcRequest, JsonRpcResponse, ToolDef } from "./types.js"

const PROTOCOL_VERSION = "2024-11-05"

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message)
  }
}

export interface ServerInfo {
  name: string
  version: string
}

export interface ClientInfo {
  name?: string
  version?: string
}

export class McpServer {
  private tools = new Map<string, ToolDef>()
  private pending = 0
  private closing = false
  private clientInfo: ClientInfo | null = null

  constructor(private info: ServerInfo) {}

  registerTool(tool: ToolDef): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool duplicada: ${tool.name}`)
    this.tools.set(tool.name, tool)
    log.debug("tool registrada", { name: tool.name })
  }

  start(): void {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
    rl.on("line", (line) => {
      const t = line.trim()
      if (t) void this.handleLine(t)
    })
    rl.on("close", () => {
      this.closing = true
      log.info("stdin cerrado", { pending: this.pending })
      if (this.pending === 0) process.exit(0)
    })
    log.info("sanctum mcp listo (stdio)", { tools: [...this.tools.keys()] })
  }

  private send(res: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(res) + "\n")
  }

  private async handleLine(line: string): Promise<void> {
    let req: JsonRpcRequest
    try {
      req = JSON.parse(line)
    } catch {
      log.error("linea json-rpc invalida", { line })
      return
    }
    const id = req.id ?? null
    const isNotification = req.id === undefined || req.id === null
    this.pending++
    try {
      const result = await this.dispatch(req)
      if (!isNotification) this.send({ jsonrpc: "2.0", id, result })
    } catch (err) {
      const code = err instanceof RpcError ? err.code : -32000
      const message = err instanceof Error ? err.message : String(err)
      log.error("fallo en request", { method: req.method, code, message })
      if (!isNotification) this.send({ jsonrpc: "2.0", id, error: { code, message } })
    } finally {
      this.pending--
      if (this.closing && this.pending === 0) process.exit(0)
    }
  }

  private async dispatch(req: JsonRpcRequest): Promise<unknown> {
    log.debug("dispatch", { method: req.method, id: req.id })
    switch (req.method) {
      case "initialize": {
        const params = (req.params ?? {}) as { clientInfo?: ClientInfo }
        this.clientInfo = params.clientInfo ?? null
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.info,
        }
      }
      case "notifications/initialized":
        return undefined
      case "ping":
        return {}
      case "tools/list":
        return {
          tools: [...this.tools.values()].map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        }
      case "tools/call": {
        const params = (req.params ?? {}) as {
          name?: string
          arguments?: Record<string, unknown>
        }
        if (!params.name) throw new RpcError(-32602, "tools/call requiere 'name'")
        const tool = this.tools.get(params.name)
        if (!tool) throw new RpcError(-32602, `Tool desconocida: ${params.name}`)
        log.info("tool call", { name: params.name, client: this.clientInfo?.name })
        try {
          return await tool.handler(params.arguments ?? {})
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return { content: [{ type: "text", text: `Error: ${message}` }], isError: true }
        }
      }
      default:
        throw new RpcError(-32601, `Metodo no encontrado: ${req.method}`)
    }
  }
}
