import { describe, it, expect } from "vitest"
import { McpServer } from "./server.js"

const INITIALIZE_INSTRUCTIONS =
  "Sanctum es un vault local de notas Markdown. Para verlo: sanctum_list_notes, sanctum_get_note y sanctum_query_vault. La búsqueda exige índice y GEMINI_API_KEYS. sanctum_list_agents enumera agentes. sanctum_invoke_agent y sanctum_run_mesh no leen el vault: pasan context a {{rag_context}} y gastan OPENCODE_GO_API_KEY."

describe("McpServer handleMessage", () => {
  function makeServer(): McpServer {
    const server = new McpServer({ name: "test-mcp", version: "0.0.1" })
    server.registerTool({
      name: "annotated_tool",
      description: "tool con annotations",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    })
    server.registerTool({
      name: "plain_tool",
      description: "tool sin annotations",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    })
    return server
  }

  it("initialize devuelve instructions con sanctum_list_notes y OPENCODE_GO_API_KEY", async () => {
    const server = makeServer()
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    })
    expect(res?.result).toMatchObject({
      instructions: INITIALIZE_INSTRUCTIONS,
    })
    expect((res?.result as { instructions: string }).instructions).toContain("sanctum_list_notes")
    expect((res?.result as { instructions: string }).instructions).toContain("OPENCODE_GO_API_KEY")
  })

  it("tools/list incluye annotations solo cuando la tool las define", async () => {
    const server = makeServer()
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })
    const tools = (res?.result as { tools: Record<string, unknown>[] }).tools
    const annotated = tools.find((t) => t.name === "annotated_tool")
    const plain = tools.find((t) => t.name === "plain_tool")
    expect(annotated?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false })
    expect(plain).not.toHaveProperty("annotations")
  })
})
