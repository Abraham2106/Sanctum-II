import { describe, expect, it } from "vitest";
import { loadAgentFromVault } from "./agent-loader";

describe("agent-loader (DEC-0022)", () => {
  const baseMd = (yaml: string, body = "Prompt {{user_prompt}}") =>
    `---\n${yaml}\n---\n${body}\n`;

  it("preserves absent model as empty string", async () => {
    const adapter = {
      read: async () => baseMd("id: test-agent\nname: Test"),
    };
    const agent = await loadAgentFromVault(adapter, "custom.md");
    expect(agent.model).toBe("");
  });

  it("keeps explicit model from frontmatter", async () => {
    const adapter = {
      read: async () => baseMd("id: test-agent\nname: Test\nmodel: grok-4.7"),
    };
    const agent = await loadAgentFromVault(adapter, "custom.md");
    expect(agent.model).toBe("grok-4.7");
  });

  it("loads agent definitions with CRLF frontmatter", async () => {
    const lf = baseMd(
      "id: crlf-agent\nname: CRLF\npermissions:\n  read_paths: []\n  write_paths: []",
    );
    const crlf = lf.replace(/\n/g, "\r\n");
    const adapter = { read: async () => crlf };
    const agent = await loadAgentFromVault(adapter, "crlf.md");
    expect(agent.id).toBe("crlf-agent");
    expect(agent.permissions.read_paths).toEqual([]);
  });
});
