import { describe, expect, it, vi } from "vitest"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { createInvokeAgentTool } from "./invoke-agent.js"
import * as opencode from "../llm/opencode-chat.js"
import { TraceWriter } from "../observability/trace-writer.js"

const AGENT = `---
id: helper
name: Helper
model: agent-model
permissions:
  read_paths: []
---
prompt {{user_prompt}}
`

function vault(reads: Record<string, string>): VaultAdapter {
  return {
    read: async (p) => {
      if (!(p in reads)) throw new Error("ENOENT")
      return reads[p]
    },
    write: async () => {},
    mkdir: async () => {},
    list: async () => ({ files: [], folders: [] }),
    exists: async (p) => p in reads,
  }
}

describe("sanctum_invoke_agent", () => {
  it("valida agent id antes de leer vault", async () => {
    const tool = createInvokeAgentTool(vault({}), "http://x", "key", new TraceWriter(vault({})))
    await expect(tool.handler({ agent_id: "../x", prompt: "hi" })).rejects.toThrow(/traversal/)
  })

  it("resuelve modelo explícito sin retrieval", async () => {
    const chatSpy = vi.spyOn(opencode, "opencodeChat").mockResolvedValue({
      content: "ok",
      usage: { prompt: 1, completion: 1 },
    })
    const v = vault({ "sanctum-agents/helper.md": AGENT })
    const tracer = new TraceWriter(v)
    vi.spyOn(tracer, "writeTrace").mockResolvedValue("trace-1")
    const tool = createInvokeAgentTool(v, "http://x", "key", tracer)

    await tool.handler({
      agent_id: "helper",
      prompt: "hello",
      context: "preloaded ctx",
      model: "override-model",
      provider: "openai",
    })

    expect(chatSpy).toHaveBeenCalledWith(
      expect.any(String),
      "hello",
      "http://x",
      "key",
      expect.objectContaining({ model: "override-model", provider: "openai" }),
    )
    chatSpy.mockRestore()
  })
})
