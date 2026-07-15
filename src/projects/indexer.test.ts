import { describe, expect, it } from "vitest";
import { VectorStore } from "../rag/vector-store";
import { indexProject } from "./indexer";

function indexingAdapter() {
  const dirs = new Set(["Research", "sanctum-logs", "sanctum-logs/index", "sanctum-logs/index/project"]);
  const files = new Map([["Research/a.md", "contenido de prueba"]]);
  return {
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return value;
    },
    write: async (path: string, content: string) => { files.set(path, content); },
    list: async (path: string) => ({
      files: [...files.keys()].filter(file => file.startsWith(`${path}/`)),
      folders: [],
    }),
    exists: async (path: string) => dirs.has(path) || files.has(path),
    mkdir: async (path: string) => { dirs.add(path); },
  };
}

describe("project index coordination", () => {
  it("deduplicates concurrent indexing for one project", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const gemini = {
      embed: async () => {
        embeddings++;
        await new Promise(resolve => setTimeout(resolve, 5));
        return [1, 0];
      },
    } as any;
    const project = { id: "project", read_paths: ["Research"], write_paths: [], name: "Project" } as any;

    await Promise.all([
      indexProject(adapter, gemini, project, store),
      indexProject(adapter, gemini, project, store),
    ]);

    expect(embeddings).toBe(1);
    expect(store.count).toBe(1);
  });

  it("rejects a partial path outside project read_paths", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    const result = await indexProject(adapter, { embed: async () => [1] } as any,
      { id: "project", read_paths: ["Research"], write_paths: [], name: "Project" } as any,
      store, { paths: ["Projects/other"] });
    expect(result.errors[0]).toContain("fuera");
    expect(store.count).toBe(0);
  });
});
