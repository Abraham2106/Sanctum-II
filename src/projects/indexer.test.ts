import { describe, expect, it } from "vitest";
import { VectorStore } from "../rag/vector-store";
import { INDEX_MANIFEST_SCHEMA_VERSION, indexProject, isProjectPathAllowed, parseIndexManifest } from "./indexer";

function indexingAdapter(initial: Record<string, string> = { "Research/a.md": "contenido de prueba" }) {
  const dirs = new Set(["Research", "Research/nested", "sanctum-logs", "sanctum-logs/index", "sanctum-logs/index/project"]);
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return value;
    },
    write: async (path: string, content: string) => { files.set(path, content); },
    list: async (path: string) => ({
      files: [...files.keys()].filter(file => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/")),
      folders: [...dirs].filter(dir => dir.startsWith(`${path}/`) && !dir.slice(path.length + 1).includes("/")),
    }),
    exists: async (path: string) => dirs.has(path) || files.has(path),
    mkdir: async (path: string) => { dirs.add(path); },
  };
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project",
    name: "Project",
    read_paths: ["Research"],
    write_paths: [],
    rag: { embed_model: "gemini-embedding-2", dims: 768, chunk_words: 3 },
    ...overrides,
  } as any;
}

describe("project incremental index", () => {
  it("treats plain read_paths as directory boundaries", () => {
    expect(isProjectPathAllowed("Research/a.md", project())).toBe(true);
    expect(isProjectPathAllowed("ResearchPrivate/a.md", project())).toBe(false);
    expect(isProjectPathAllowed("sanctum-logs/a.md", project({ read_paths: ["**"] }))).toBe(false);
  });

  it("serializes concurrent indexing and embeds an unchanged document once", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const provider = { embed: async () => { embeddings++; await new Promise(resolve => setTimeout(resolve, 5)); return [1, 0]; } };

    await Promise.all([
      indexProject(adapter, provider, project(), store),
      indexProject(adapter, provider, project(), store),
    ]);

    expect(embeddings).toBe(1);
    expect(store.count).toBe(1);
  });

  it("makes zero embedding calls for unchanged content and configuration", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const provider = { embed: async () => { embeddings++; return [1]; } };
    await indexProject(adapter, provider, project(), store);
    const second = await indexProject(adapter, provider, project(), store);
    expect(embeddings).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.generatedEmbeddings).toBe(0);
  });

  it("re-embeds only a changed chunk and reuses intact chunks", async () => {
    const adapter = indexingAdapter({ "Research/a.md": "uno dos tres cuatro cinco seis" });
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const provider = { embed: async () => [++embeddings] };
    await indexProject(adapter, provider, project(), store);
    adapter.files.set("Research/a.md", "uno dos tres cuatro cinco siete");
    const result = await indexProject(adapter, provider, project(), store, { changes: [{ type: "upsert", path: "Research/a.md" }] });
    expect(result.generatedEmbeddings).toBe(1);
    expect(result.reusedEmbeddings).toBe(1);
    expect(embeddings).toBe(3);
  });

  it("reuses identical chunks inside one project", async () => {
    const adapter = indexingAdapter({ "Research/a.md": "igual contenido", "Research/b.md": "igual contenido" });
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const result = await indexProject(adapter, { embed: async () => { embeddings++; return [1]; } }, project(), store);
    expect(embeddings).toBe(1);
    expect(result.reusedEmbeddings).toBe(1);
    expect(store.count).toBe(2);
  });

  it("does not share an embedding cache between project stores", async () => {
    const adapter = indexingAdapter({ "Research/a.md": "igual contenido" });
    let embeddings = 0;
    const provider = { embed: async () => { embeddings++; return [1]; } };
    await indexProject(adapter, provider, project({ id: "project" }), new VectorStore("sanctum-logs/index/project/vector-store.jsonl"));
    await indexProject(adapter, provider, project({ id: "other" }), new VectorStore("sanctum-logs/index/other/vector-store.jsonl"));
    expect(embeddings).toBe(2);
  });

  it("invalidates document fingerprints when embedding configuration changes", async () => {
    const adapter = indexingAdapter({ "Research/a.md": "contenido estable" });
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const provider = { embed: async () => [++embeddings] };
    await indexProject(adapter, provider, project(), store);
    const changedDims = project({ rag: { embed_model: "gemini-embedding-2", dims: 256, chunk_words: 3 } });
    const result = await indexProject(adapter, provider, changedDims, store);
    expect(result.generatedEmbeddings).toBe(1);
    expect(embeddings).toBe(2);
    const manifest = JSON.parse(adapter.files.get("sanctum-logs/index/project/manifest.json")!);
    expect(manifest.schema_version).toBe(INDEX_MANIFEST_SCHEMA_VERSION);
    expect(manifest.documents["Research/a.md"].config_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("removes stale chunks on delete and coordinates rename", async () => {
    const adapter = indexingAdapter({ "Research/a.md": "contenido" });
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const provider = { embed: async () => [++embeddings] };
    await indexProject(adapter, provider, project(), store);
    adapter.files.delete("Research/a.md");
    adapter.files.set("Research/b.md", "contenido");
    const renamed = await indexProject(adapter, provider, project(), store, { changes: [{ type: "rename", oldPath: "Research/a.md", path: "Research/b.md" }] });
    expect(store.allChunks.map(chunk => chunk.note_path)).toEqual(["Research/b.md"]);
    expect(renamed.generatedEmbeddings).toBe(0);
    expect(embeddings).toBe(1);
    adapter.files.delete("Research/b.md");
    await indexProject(adapter, provider, project(), store, { changes: [{ type: "delete", path: "Research/b.md" }] });
    expect(store.count).toBe(0);
  });

  it("recursively indexes nested Markdown and excludes internal paths", async () => {
    const adapter = indexingAdapter({ "Research/nested/paper.md": "paper", "sanctum-logs/private.md": "private" });
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    await indexProject(adapter, { embed: async () => [1] }, project(), store);
    expect(store.allChunks.map(chunk => chunk.note_path)).toEqual(["Research/nested/paper.md"]);
  });

  it("rejects a partial path outside project read_paths", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    const result = await indexProject(adapter, { embed: async () => [1] }, project(), store, { paths: ["Projects/other"] });
    expect(result.errors[0]).toContain("fuera");
    expect(store.count).toBe(0);
  });

  it("migrates a legacy manifest by forcing one safe rebuild", () => {
    const parsed = parseIndexManifest(JSON.stringify({ "Research/a.md": "old-hash" }));
    expect(parsed.migrated).toBe(true);
    expect(parsed.manifest.schema_version).toBe(INDEX_MANIFEST_SCHEMA_VERSION);
    expect(parsed.manifest.documents).toEqual({});
  });
});
