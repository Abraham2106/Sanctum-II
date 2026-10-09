import { describe, expect, it } from "vitest";
import type { VaultAdapter } from "../../../src/core/vault-adapter.js";
import { createListAgentsTool } from "./list-agents.js";

function syntheticVault(files: Record<string, string>): VaultAdapter {
  return {
    async list() {
      return { files: Object.keys(files), folders: [] };
    },
    async read(path: string) {
      const content = files[path];
      if (content === undefined) throw new Error(`missing fixture: ${path}`);
      return content;
    },
    async write() {
      throw new Error("read-only fixture vault");
    },
    async mkdir() {},
    async exists() {
      return true;
    },
  };
}

describe("list-agents tool (DEC-0022)", () => {
  it("lists agents parsed via shared splitFrontmatter (CRLF fixture)", async () => {
    const md =
      "---\r\nid: forager\r\nname: Forager\r\ninternal: true\r\n---\r\nbody\r\n";
    const vault = syntheticVault({ "sanctum-agents/forager.md": md });
    const tool = createListAgentsTool(vault);
    const result = await tool.handler({});
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("forager");
    expect(text).toContain("Forager");
  });

  it("skips files with invalid frontmatter without failing the catalog", async () => {
    const vault = syntheticVault({
      "sanctum-agents/good.md": "---\nid: good\n---\n",
      "sanctum-agents/bad.md": "not markdown frontmatter",
    });
    const tool = createListAgentsTool(vault);
    const result = await tool.handler({});
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("good");
    expect(text).not.toContain("bad");
  });
});
