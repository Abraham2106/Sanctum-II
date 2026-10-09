import { describe, expect, it } from "vitest";
import { VectorStore } from "../rag/vector-store";
import { indexProject, buildTestGeminiIdentity } from "./indexer";
import {
  findNewestCompleteGeneration,
  generationFile,
  loadIndexGenerationSnapshot,
} from "./index-generations";
import type { SanctumSettings } from "../constants";

function testSettings(): SanctumSettings {
  return {
    geminiApiKeys: "test-key",
    embeddingBackend: "gemini",
    localEmbeddingPort: 8767,
    localEmbeddingToken: "",
    localEmbeddingRevision: "",
    localEmbeddingDims: 768,
    localEmbeddingDevice: "cpu",
    localEmbeddingDtype: "float32",
  } as SanctumSettings;
}

function indexingAdapter(options?: { listFailsFor?: string }) {
  const dirs = new Set(["Research", "sanctum-logs", "sanctum-logs/index", "sanctum-logs/index/project"]);
  const files = new Map([["Research/a.md", "contenido de prueba"]]);
  const ensureDir = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    let cur = "";
    for (const p of parts.slice(0, -1)) {
      cur = cur ? `${cur}/${p}` : p;
      dirs.add(cur);
    }
  };
  return {
    files,
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return value;
    },
    write: async (path: string, content: string) => {
      ensureDir(path);
      files.set(path, content);
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir) dirs.add(dir);
    },
    list: async (path: string) => {
      if (options?.listFailsFor === path) {
        throw new Error("list denied");
      }
      const prefix = path.replace(/\\/g, "/");
      const fileOut: string[] = [];
      const folderOut = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(`${prefix}/`)) continue;
        const rest = key.slice(prefix.length + 1);
        const slash = rest.indexOf("/");
        if (slash === -1) fileOut.push(key);
        else folderOut.add(`${prefix}/${rest.slice(0, slash)}`);
      }
      for (const d of dirs) {
        if (!d.startsWith(`${prefix}/`)) continue;
        const rest = d.slice(prefix.length + 1);
        if (rest && !rest.includes("/")) folderOut.add(d);
      }
      return { files: fileOut, folders: [...folderOut] };
    },
    exists: async (path: string) => dirs.has(path) || files.has(path),
    mkdir: async (path: string) => {
      dirs.add(path);
    },
    rename: async (oldPath: string, newPath: string) => {
      const v = files.get(oldPath);
      if (v === undefined) throw new Error("missing");
      files.delete(oldPath);
      files.set(newPath, v);
    },
    remove: async (path: string) => {
      files.delete(path);
    },
  };
}

function testProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project",
    read_paths: ["Research"],
    write_paths: [],
    name: "Project",
    rag: { embed_model: "gemini-embedding-2", dims: 2, chunk_words: 400, top_k: 5, min_similarity: 0.5 },
    ...overrides,
  } as any;
}

function syntheticEmbedder(onEmbed?: () => void) {
  const identity = buildTestGeminiIdentity(testProject());
  return {
    hasKeys: true,
    embed: async (_text: string, opts?: { purpose?: string }) => {
      expect(opts?.purpose).toBe("document");
      onEmbed?.();
      return [1, 0];
    },
    identity,
  };
}

describe("project index coordination", () => {
  it("deduplicates concurrent indexing for one project", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const embedder = syntheticEmbedder(() => {
      embeddings++;
    });

    await Promise.all([
      indexProject(adapter, embedder, testProject(), store, { settings: testSettings() }),
      indexProject(adapter, embedder, testProject(), store, { settings: testSettings() }),
    ]);

    expect(embeddings).toBe(1);
    expect(store.count).toBe(1);
    const gen = await findNewestCompleteGeneration(adapter, "project");
    expect(gen).not.toBeNull();
  });

  it("denies indexing when read_paths is empty", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    const result = await indexProject(
      adapter,
      syntheticEmbedder(),
      testProject({ read_paths: [] }),
      store,
      { settings: testSettings() },
    );
    expect(result.errors[0]).toMatch(/read_paths/);
    expect(await findNewestCompleteGeneration(adapter, "project")).toBeNull();
  });

  it("rejects a partial path outside project read_paths", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    const result = await indexProject(
      adapter,
      syntheticEmbedder(),
      testProject(),
      store,
      { paths: ["Projects/other"], settings: testSettings() },
    );
    expect(result.errors[0]).toContain("fuera");
    expect(store.count).toBe(0);
  });

  it("rejects a parent folder when read_paths only allow a child path", async () => {
    const adapter = indexingAdapter();
    await adapter.mkdir("Vault");
    await adapter.mkdir("Vault/Research");
    await adapter.write("Vault/secret.md", "secret");
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    const result = await indexProject(
      adapter,
      syntheticEmbedder(),
      testProject({ read_paths: ["Vault/Research"] }),
      store,
      { paths: ["Vault"], settings: testSettings() },
    );
    expect(result.errors[0]).toContain("fuera");
    expect(store.count).toBe(0);
  });

  it("allows a subfolder inside a configured read_path", async () => {
    const adapter = indexingAdapter();
    await adapter.mkdir("Research/notes");
    await adapter.write("Research/notes/a.md", "nota");
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    const result = await indexProject(
      adapter,
      syntheticEmbedder(),
      testProject(),
      store,
      { paths: ["Research/notes"], settings: testSettings() },
    );
    expect(result.errors.some((e) => e.includes("fuera"))).toBe(false);
    expect(store.count).toBeGreaterThan(0);
  });

  it("indexes nested markdown recursively", async () => {
    const adapter = indexingAdapter();
    await adapter.mkdir("Research/deep/nested");
    await adapter.write("Research/deep/nested/b.md", "nested note");
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    await indexProject(adapter, syntheticEmbedder(() => embeddings++), testProject(), store, {
      settings: testSettings(),
    });
    expect(embeddings).toBe(2);
    expect(store.count).toBe(2);
  });

  it("chunks notes with project.rag.chunk_words when set", async () => {
    const adapter = indexingAdapter();
    const words = Array.from({ length: 10 }, (_, i) => `w${i}`).join(" ");
    await adapter.write("Research/a.md", words);
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const project = testProject({ rag: { embed_model: "gemini-embedding-2", dims: 2, chunk_words: 3, top_k: 5, min_similarity: 0.5 } });

    await indexProject(adapter, syntheticEmbedder(() => embeddings++), project, store, {
      settings: testSettings(),
    });

    expect(embeddings).toBe(4);
    expect(store.count).toBe(4);
  });

  it("chunk config change invalidates vector reuse", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    let embeddings = 0;
    const embedder = syntheticEmbedder(() => embeddings++);
    const base = testProject();

    await indexProject(adapter, embedder, base, store, { settings: testSettings() });
    expect(embeddings).toBe(1);
    embeddings = 0;

    const changed = testProject({
      rag: { embed_model: "gemini-embedding-2", dims: 2, chunk_words: 1, top_k: 5, min_similarity: 0.5 },
    });
    await indexProject(adapter, embedder, changed, store, { settings: testSettings() });
    expect(embeddings).toBeGreaterThan(0);
  });

  it("list failure does not publish a new generation", async () => {
    const adapter = indexingAdapter({ listFailsFor: "Research" });
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    const before = adapter.files.size;
    const result = await indexProject(adapter, syntheticEmbedder(), testProject(), store, {
      settings: testSettings(),
    });
    expect(result.errors.some((e) => e.includes("list"))).toBe(true);
    expect(await findNewestCompleteGeneration(adapter, "project")).toBeNull();
    expect(adapter.files.size).toBe(before);
  });

  it("failed rebuild leaves prior generation active in snapshot", async () => {
    const adapter = indexingAdapter();
    const store = new VectorStore("sanctum-logs/index/project/vector-store.jsonl");
    await indexProject(adapter, syntheticEmbedder(), testProject(), store, { settings: testSettings() });
    const first = await findNewestCompleteGeneration(adapter, "project");
    expect(first?.generationId).toBeTruthy();

    await adapter.write("Research/a.md", "contenido distinto para forzar re-embed");

    const failing = {
      hasKeys: true,
      embed: async () => {
        throw new Error("embed failed");
      },
    };
    await indexProject(adapter, failing, testProject(), store, { settings: testSettings() });
    const second = await findNewestCompleteGeneration(adapter, "project");
    expect(second?.generationId).toBe(first?.generationId);
  });

  it("interrupted generation without commit is not readable as ready", async () => {
    const adapter = indexingAdapter();
    await adapter.mkdir("sanctum-logs/index/project/generations/orphan");
    await adapter.write(generationFile("project", "orphan", "metadata.json"), "{}");
    const snap = await loadIndexGenerationSnapshot(adapter, "project");
    expect(snap.status).not.toBe("ready");
  });
});
