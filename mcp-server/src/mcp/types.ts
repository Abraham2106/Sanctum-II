export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface ToolContent {
  type: "text"
  text: string
}

export interface ToolResult {
  content: ToolContent[]
  isError?: boolean
}

export type JsonSchema = Record<string, unknown>

export interface ToolDef {
  name: string
  description: string
  inputSchema: JsonSchema
  handler: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult
}
