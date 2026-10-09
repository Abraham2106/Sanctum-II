import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_RAG, type Project } from "./types";
import { parseProjectMd, serializeProject } from "./project-md";

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "demo",
    name: "Line\nBreak",
    icon: "◈",
    description: "",
    instructions: "line one\n\nline three",
    read_paths: ['path "quoted"/x'],
    write_paths: ["/Projects/demo/"],
    outputPath: "Projects/demo",
    model: "",
    rag: { ...DEFAULT_PROJECT_RAG, min_similarity: 0 },
    files: [],
    attachedFiles: [],
    ...overrides,
  };
}

describe("project-md (DEC-0022 synthetic fixtures)", () => {
  it("roundtrips YAML edge cases via shared frontmatter APIs", () => {
    const original = baseProject();
    const md = serializeProject(original);
    const parsed = parseProjectMd(md);
    expect(parsed.name).toBe("Line\nBreak");
    expect(parsed.read_paths).toEqual(['path "quoted"/x']);
    expect(parsed.rag.min_similarity).toBe(0);
    expect(parsed.instructions).toBe("line one\n\nline three");
    expect(parsed.model).toBe("");
  });

  it("roundtrips optional embedding provider block", () => {
    const REV = "abcdef0123456789abcdef0123456789abcdef01";
    const md = `---
id: local
name: n
icon: x
read_paths: []
write_paths: []
outputPath: Projects/local
rag:
  embed_model: gemini-embedding-2
  dims: 768
  chunk_words: 400
  top_k: 5
  min_similarity: 0.65
embedding:
  backend: sentence-transformers
  model: google/embeddinggemma-2
  revision: ${REV}
  dims: 512
instructions: |
  body
---

`;
    const parsed = parseProjectMd(md);
    expect(parsed.embedding).toEqual({
      backend: "sentence-transformers",
      model: "google/embeddinggemma-2",
      revision: REV,
      dims: 512,
    });
    const reserialized = serializeProject({ ...parsed, instructions: parsed.instructions });
    expect(parseProjectMd(reserialized).embedding).toEqual(parsed.embedding);
  });

  it("preserves missing model as empty string", () => {
    const md = `---
id: nomodel
name: n
icon: x
read_paths: []
write_paths: []
outputPath: Projects/nomodel
rag:
  embed_model: e
  dims: 1
  chunk_words: 1
  top_k: 1
  min_similarity: 0
instructions: |
  body
---

`;
    expect(parseProjectMd(md).model).toBe("");
  });
});
