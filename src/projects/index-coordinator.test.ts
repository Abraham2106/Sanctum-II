import { describe, expect, it } from "vitest";
import { VectorStore } from "../rag/vector-store";
import { IncrementalIndexCoordinator, type IndexCoordinatorStatus } from "./index-coordinator";

function vaultAdapter(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set(["Research", "sanctum-logs", "sanctum-logs/index"]);
  return {
    files,
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return value;
    },
    write: async (path: string, content: string) => { files.set(path, content); },
    mkdir: async (path: string) => { dirs.add(path); },
    list: async (path: string) => ({
      files: [...files.keys()].filter(file => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/")),
      folders: [],
    }),
    exists: async (path: string) => dirs.has(path) || files.has(path),
  };
}

function testProject(id: string, readPaths = ["Research"]) {
  return {
    id, name: id, read_paths: readPaths, write_paths: [],
    rag: { embed_model: "gemini-embedding-2", dims: 768, chunk_words: 400 },
  } as any;
}

describe("IncrementalIndexCoordinator", () => {
  it("coalesces events and updates every compatible project", async () => {
    const adapter = vaultAdapter({ "Research/new.md": "nuevo conocimiento" });
    const projects = new Map([["one", testProject("one")], ["two", testProject("two")], ["other", testProject("other", ["Other"])]]);
    const stores = new Map<string, VectorStore>();
    let embeddingCalls = 0;
    const coordinator = new IncrementalIndexCoordinator({
      adapter: adapter as any,
      projectStore: {
        listProjects: async () => [...projects.keys()],
        loadProject: async (id: string) => projects.get(id)!,
      } as any,
      getVectorStore: id => {
        let store = stores.get(id);
        if (!store) { store = new VectorStore(`sanctum-logs/index/${id}/vector-store.jsonl`); stores.set(id, store); }
        return store;
      },
      getEmbeddingProvider: () => ({ embed: async () => { embeddingCalls++; return [1]; } }),
      canEmbed: () => true,
      debounceMs: 60_000,
    });

    await coordinator.queueChange({ type: "upsert", path: "Research/new.md" });
    await coordinator.queueChange({ type: "upsert", path: "Research/new.md" });
    await coordinator.flushPending();

    expect(stores.get("one")?.count).toBe(1);
    expect(stores.get("two")?.count).toBe(1);
    expect(stores.has("other")).toBe(false);
    expect(embeddingCalls).toBe(2);
    coordinator.dispose();
  });

  it("keeps an upsert pending until an embedding key becomes available", async () => {
    const adapter = vaultAdapter({ "Research/pending.md": "pendiente" });
    let canEmbed = false;
    const statuses: IndexCoordinatorStatus[] = [];
    const store = new VectorStore("sanctum-logs/index/one/vector-store.jsonl");
    const coordinator = new IncrementalIndexCoordinator({
      adapter: adapter as any,
      projectStore: { listProjects: async () => ["one"], loadProject: async () => testProject("one") } as any,
      getVectorStore: () => store,
      getEmbeddingProvider: () => ({ embed: async () => [1] }),
      canEmbed: () => canEmbed,
      debounceMs: 60_000,
      onStatus: status => statuses.push(status),
    });

    await coordinator.queueChange({ type: "upsert", path: "Research/pending.md" });
    await coordinator.flushPending();
    expect(store.count).toBe(0);
    expect(statuses.at(-1)?.state).toBe("waiting-for-keys");
    canEmbed = true;
    await coordinator.flushPending();
    expect(store.count).toBe(1);
    coordinator.dispose();
  });

  it("ignores internal Markdown and paths outside every project", async () => {
    const adapter = vaultAdapter({ "sanctum-logs/private.md": "private", "Other/out.md": "outside" });
    const store = new VectorStore("sanctum-logs/index/one/vector-store.jsonl");
    const coordinator = new IncrementalIndexCoordinator({
      adapter: adapter as any,
      projectStore: { listProjects: async () => ["one"], loadProject: async () => testProject("one") } as any,
      getVectorStore: () => store,
      getEmbeddingProvider: () => ({ embed: async () => [1] }),
      canEmbed: () => true,
      debounceMs: 60_000,
    });
    await coordinator.queueChange({ type: "upsert", path: "sanctum-logs/private.md" });
    await coordinator.queueChange({ type: "upsert", path: "Other/out.md" });
    await coordinator.flushPending();
    expect(store.count).toBe(0);
    coordinator.dispose();
  });

  it("skips corrupt projects during reconcileAll without aborting others", async () => {
    const adapter = vaultAdapter({ "Research/a.md": "ok" });
    const store = new VectorStore("sanctum-logs/index/good/vector-store.jsonl");
    const statuses: IndexCoordinatorStatus[] = [];
    const coordinator = new IncrementalIndexCoordinator({
      adapter: adapter as any,
      projectStore: {
        listProjects: async () => ["broken", "good"],
        loadProject: async (id: string) => {
          if (id === "broken") throw new Error("Formato inválido: el archivo debe tener frontmatter --- separado");
          return testProject("good");
        },
      } as any,
      getVectorStore: () => store,
      getEmbeddingProvider: () => ({ embed: async () => [1] }),
      canEmbed: () => true,
      debounceMs: 60_000,
      onStatus: status => statuses.push(status),
    });

    await expect(coordinator.reconcileAll()).resolves.toBeUndefined();
    expect(store.count).toBe(1);
    expect(statuses.some(s => s.projectId === "broken" && s.state === "error")).toBe(true);
    expect(statuses.some(s => s.projectId === "good" && s.state === "indexed")).toBe(true);
    coordinator.dispose();
  });
});
