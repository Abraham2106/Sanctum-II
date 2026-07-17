import { describe, expect, it } from "vitest";
import { chunkText } from "./indexer";

describe("formula-aware project chunker", () => {
  it("does not split display math at the word boundary", () => {
    const prefix = Array.from({ length: 8 }, (_, i) => `word${i}`).join(" ");
    const formula = "$$\\begin{aligned}\nH &= \\sum_i h_i Z_i + \\sum_{i<j} J_{ij} Z_i Z_j \\\\[2pt]\n&\\quad + \\lambda \\sum_k (1-Z_k)^2\n\\tag{1}\n\\end{aligned}$$";
    const chunks = chunkText(`${prefix} ${formula} after`, 8);
    expect(chunks.join(" ")).toContain(formula);
    expect(chunks.some(chunk => chunk.includes(formula))).toBe(true);
    expect(chunks.every(chunk => !chunk.includes("$$") || (chunk.match(/\$\$/g) || []).length === 2)).toBe(true);
  });

  it("preserves multiline equations, subindices and escaped dollars", () => {
    const text = [
      "Texto con \\(x_i\\) y un precio de \\$5.",
      "\\begin{equation}",
      "Q_{ij} = Q_{ji}, \\qquad x_i \\in \\{0,1\\}",
      "\\label{eq:qubo}",
      "\\end{equation}",
    ].join("\n");
    const chunks = chunkText(text, 2);
    expect(chunks.join("\n")).toContain("\\begin{equation}\nQ_{ij} = Q_{ji}");
    expect(chunks.join("\n")).toContain("\\label{eq:qubo}");
    expect(chunks.join("\n")).toContain("\\$5");
    expect(chunks.join("\n")).toContain("\\(x_i\\)");
    expect(chunks.filter(chunk => chunk.includes("\\begin{equation}")).length).toBe(1);
  });

  it("keeps code examples opaque", () => {
    const text = "Antes\n```tex\n$$ x_i $$\n\\begin{equation} y_i \\end{equation}\n```\nDespues";
    const chunks = chunkText(text, 1);
    const codeChunk = chunks.find(chunk => chunk.includes("```tex"));
    expect(codeChunk).toContain("$$ x_i $$");
    expect(codeChunk).toContain("\\begin{equation} y_i \\end{equation}");
  });

  it("emits an oversized formula intact", () => {
    const formula = `$$ ${Array.from({ length: 30 }, (_, i) => `x_{${i}}`).join(" + ")} $$`;
    const chunks = chunkText(formula, 3);
    expect(chunks).toEqual([formula]);
  });
});
