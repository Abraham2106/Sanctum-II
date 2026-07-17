import { describe, expect, it } from "vitest";
import { NoteWriter } from "./note-writer";
import type { VaultAdapter } from "./vault-adapter";

class MemoryVault implements VaultAdapter {
  files = new Map<string, string>();
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error("not found");
    return value;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async mkdir(): Promise<void> {}
  async list(): Promise<{ files: string[]; folders: string[] }> { return { files: [], folders: [] }; }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
}

describe("NoteWriter Markdown fidelity", () => {
  it("writes create content literally, including LaTeX delimiters", async () => {
    const vault = new MemoryVault();
    const content = "# QUBO\n\n$$\nQ_{ij} = \\frac{1}{2} J_{ij} x_i x_j\\tag{1}\n$$";
    await new NoteWriter(vault).create("Research/qubo.md", content);
    expect(vault.files.get("Research/qubo.md")).toBe(content);
  });

  it("appends without escaping or flattening an existing formula", async () => {
    const vault = new MemoryVault();
    const existing = "## Hamiltoniano\n\\(H = \\sum_i h_i s_i\\)";
    const addition = "$$ J_{ij} s_i s_j $$";
    vault.files.set("Research/ising.md", existing);
    await new NoteWriter(vault).append("Research/ising.md", addition);
    expect(vault.files.get("Research/ising.md")).toBe(`${existing}\n\n${addition}`);
  });
});
