import { describe, expect, it } from "vitest";
import { ProjectStore } from "./store";

/** Synthetic in-memory vault double — not production integration evidence. */
function memoryAdapter() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return value;
    },
    write: async (path: string, content: string) => { files.set(path, content); },
    mkdir: async () => {},
    remove: async (path: string) => { files.delete(path); },
    list: async (dir: string) => ({
      files: [...files.keys()].filter((p) => p.startsWith(`${dir}/`)),
      folders: [],
    }),
    exists: async (path: string) => files.has(path),
  };
}

describe("ProjectStore durability (DEC-0022)", () => {
  it("rejects project id traversal on load", async () => {
    const store = new ProjectStore(memoryAdapter());
    await expect(store.loadProject("../x")).rejects.toThrow(/denied/);
  });

  it("rejects on-disk project id mismatch", async () => {
    const adapter = memoryAdapter();
    adapter.files.set(
      "sanctum-projects/wrong.md",
      "---\nid: other\nname: n\nicon: x\nread_paths: []\nwrite_paths: []\noutputPath: Projects/other\nrag:\n  embed_model: e\n  dims: 1\n  chunk_words: 1\n  top_k: 1\n  min_similarity: 0\ninstructions: |\n  body\n---\n"
    );
    const store = new ProjectStore(adapter);
    await expect(store.loadProject("wrong")).rejects.toThrow(/id mismatch/);
  });

  it("preserves missing model as empty string", async () => {
    const adapter = memoryAdapter();
    adapter.files.set(
      "sanctum-projects/nomodel.md",
      "---\nid: nomodel\nname: n\nicon: x\nread_paths: []\nwrite_paths: []\noutputPath: Projects/nomodel\nrag:\n  embed_model: e\n  dims: 1\n  chunk_words: 1\n  top_k: 1\n  min_similarity: 0\ninstructions: |\n  body\n---\n"
    );
    const store = new ProjectStore(adapter);
    const p = await store.loadProject("nomodel");
    expect(p.model).toBe("");
  });

  it("propagates corrupted thread JSON on loadThreadData", async () => {
    const adapter = memoryAdapter();
    adapter.files.set(
      "sanctum-logs/threads/project/bad.json",
      "{not-json"
    );
    const store = new ProjectStore(adapter);
    await expect(store.loadThreadData("project", "bad")).rejects.toThrow();
  });

  it("rejects embedded thread id mismatch on loadThreadData", async () => {
    const adapter = memoryAdapter();
    adapter.files.set(
      "sanctum-logs/threads/project/wrong.json",
      JSON.stringify({
        thread: {
          thread_id: "other",
          project_id: "project",
          title: "t",
          created_at: 1,
          updated_at: 1,
          starred: false,
        },
        messages: [],
      })
    );
    const store = new ProjectStore(adapter);
    await expect(store.loadThreadData("project", "wrong")).rejects.toThrow(/Thread id mismatch/);
  });

  it("fails move when destination thread already exists without writing destination", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore(adapter);
    await store.updateThreadMessages("source", "thread", [{ role: "user", content: "a" }]);
    await store.updateThreadMessages("target", "thread", [{ role: "user", content: "b" }]);

    await expect(store.moveThread("source", "thread", "target")).rejects.toThrow(/already exists/);
    expect(await store.loadThreadData("source", "thread")).not.toBeNull();
    const dest = await store.loadThreadData("target", "thread");
    expect(dest?.messages[0]?.content).toBe("b");
  });

  it("serializes rename and star across two store instances on the same adapter", async () => {
    const adapter = memoryAdapter();
    const a = new ProjectStore(adapter);
    const b = new ProjectStore(adapter);
    await a.updateThreadMessages("project", "thread", [{ role: "user", content: "seed" }]);
    await Promise.all([
      a.renameThread("project", "thread", "Renamed"),
      b.toggleStarThread("project", "thread"),
    ]);
    const data = await a.loadThreadData("project", "thread");
    expect(data?.thread.title).toBe("Renamed");
    expect(data?.thread.starred).toBe(true);
  });

  it("completes opposite thread moves without deadlock", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore(adapter);
    await store.updateThreadMessages("left", "move-a", [{ role: "user", content: "L" }]);
    await store.updateThreadMessages("right", "move-b", [{ role: "user", content: "R" }]);
    const results = await Promise.allSettled([
      store.moveThread("left", "move-a", "right"),
      store.moveThread("right", "move-b", "left"),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await store.loadThreadData("right", "move-a"))?.messages[0]?.content).toBe("L");
    expect((await store.loadThreadData("left", "move-b"))?.messages[0]?.content).toBe("R");
  });

  it("propagates exists errors on move", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore(adapter);
    await store.updateThreadMessages("source", "thread", [{ role: "user", content: "a" }]);
    const failing = new ProjectStore({
      ...adapter,
      exists: async () => { throw new Error("exists backend down"); },
    });
    await expect(failing.moveThread("source", "thread", "target")).rejects.toThrow(/exists backend/);
  });

  it("serializes concurrent memory appends", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore(adapter);
    await Promise.all([
      store.appendMemory("project", { timestamp: 1, text: "first" }),
      store.appendMemory("project", { timestamp: 2, text: "second" }),
    ]);
    expect((await store.loadMemory("project")).map((e) => e.text)).toEqual(["first", "second"]);
  });

  it("fails closed on appendMemory read errors", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore({
      ...adapter,
      read: async (path: string) => {
        if (path.includes("memory.jsonl")) throw new Error("read fault");
        return adapter.read(path);
      },
    });
    await expect(store.appendMemory("project", { timestamp: 1, text: "x" })).rejects.toThrow(/read fault/);
  });

  it("rejects patchThreadData that changes thread_id", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore(adapter);
    await store.updateThreadMessages("project", "thread", [{ role: "user", content: "hi" }]);
    await expect(
      store.patchThreadData("project", "thread", (data) => {
        data.thread.thread_id = "other";
        return data;
      })
    ).rejects.toThrow(/Thread id mismatch/);
  });

  it("shares thread locks between two store instances on the same adapter", async () => {
    const adapter = memoryAdapter();
    const a = new ProjectStore(adapter);
    const b = new ProjectStore(adapter);
    await Promise.all([
      a.updateThreadMessages("project", "thread", [{ role: "user", content: "from-a" }]),
      b.updateThreadMessages("project", "thread", [{ role: "user", content: "from-b" }]),
    ]);
    const messages = (await a.loadThreadData("project", "thread"))?.messages || [];
    expect(messages).toHaveLength(1);
    expect(["from-a", "from-b"]).toContain(messages[0].content);
  });
});
