import { describe, expect, it } from "vitest";
import { ProjectStore } from "./projects/store";
import { Tracer } from "./observability/tracer";
import { KgEdgeStore } from "./kg/kg-store";

function memoryAdapter() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
    write: async (path: string, content: string) => { files.set(path, content); },
    mkdir: async () => {},
    rename: async (oldPath: string, newPath: string) => {
      const value = files.get(oldPath);
      if (value === undefined) throw new Error("ENOENT");
      files.set(newPath, value);
      files.delete(oldPath);
    },
    remove: async (path: string) => { files.delete(path); },
    list: async () => ({ files: [], folders: [] }),
    exists: async (path: string) => files.has(path),
  };
}

describe("P0 regressions", () => {
  it("persists two concurrent traces independently", async () => {
    const writes: string[] = [];
    const tracer = new Tracer({
      read: async () => "",
      exists: async () => { await new Promise(resolve => setTimeout(resolve, 1)); return true; },
      write: async (path, content) => { if (path.endsWith(".json")) writes.push(content); },
      mkdir: async () => {},
      list: async () => ({ files: [], folders: [] }),
    });

    const first = tracer.start("a", "", "one");
    const second = tracer.start("b", "", "two");
    await Promise.all([
      tracer.finish(first, "out-one"),
      tracer.finish(second, "out-two"),
    ]);

    expect(writes).toHaveLength(2);
    expect(writes.map(raw => JSON.parse(raw).output).sort()).toEqual(["out-one", "out-two"]);
  });

  it("allows pendingAction to be explicitly cleared", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore(adapter);
    await store.updateThreadMessages("project", "thread", [{ role: "user", content: "hello" }]);
    await store.patchThreadData("project", "thread", data => {
      data.pendingAction = { type: "research", description: "x", params: {}, proposed_at: Date.now() };
      return data;
    });
    await store.patchThreadData("project", "thread", data => {
      data.pendingAction = undefined;
      return data;
    });

    expect((await store.loadThreadData("project", "thread"))?.pendingAction).toBeUndefined();
  });

  it("serializes concurrent message updates without losing the latest message", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore(adapter);
    await Promise.all([
      store.updateThreadMessages("project", "thread", [{ role: "user", content: "first" }]),
      store.updateThreadMessages("project", "thread", [{ role: "user", content: "second" }]),
    ]);

    const messages = (await store.loadThreadData("project", "thread"))?.messages || [];
    expect(messages).toHaveLength(1);
    expect(["first", "second"]).toContain(messages[0].content);
  });

  it("overwrites an existing thread when rename refuses destination replacement", async () => {
    const files = new Map<string, string>();
    const adapter = {
      read: async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw Object.assign(new Error("destination missing"), { code: "ENOENT" });
        return value;
      },
      write: async (path: string, content: string) => { files.set(path, content); },
      rename: async (_from: string, to: string) => {
        if (files.has(to)) throw new Error("Destination file already exists!");
      },
      remove: async (path: string) => { files.delete(path); },
      mkdir: async () => {},
      list: async () => ({ files: [], folders: [] }),
      exists: async (path: string) => files.has(path),
    };
    const store = new ProjectStore(adapter);

    await store.updateThreadMessages("project", "thread", [{ role: "user", content: "first" }]);
    await store.updateThreadMessages("project", "thread", [{ role: "user", content: "second" }]);

    const saved = JSON.parse(files.get("sanctum-logs/threads/project/thread.json")!);
    expect(saved.messages[0].content).toBe("second");
  });

  it("moves a thread as a complete record and removes the source", async () => {
    const adapter = memoryAdapter();
    const store = new ProjectStore(adapter);
    await store.updateThreadMessages("source", "thread", [{ role: "user", content: "hello" }]);
    await store.patchThreadData("source", "thread", data => {
      data.summary = "summary";
      data.pendingAction = { type: "research", description: "x", params: {}, proposed_at: Date.now() };
      data.createdNotes = [{ path: "Research/x.md", title: "x", created_at: Date.now() }];
      return data;
    });

    await store.moveThread("source", "thread", "target");

    expect(await store.loadThreadData("source", "thread")).toBeNull();
    const moved = await store.loadThreadData("target", "thread");
    expect(moved?.thread.project_id).toBe("target");
    expect(moved?.summary).toBe("summary");
    expect(moved?.pendingAction?.type).toBe("research");
    expect(moved?.createdNotes).toHaveLength(1);
  });

  it("keeps KG stores isolated by their configured paths", async () => {
    const adapter = memoryAdapter();
    const first = new KgEdgeStore("sanctum-logs/index/one/kg-edges.jsonl");
    const second = new KgEdgeStore("sanctum-logs/index/two/kg-edges.jsonl");
    first.addEdge({ from: "one.md", to: "shared.md", type: "semantic", weight: 0.9, relation: "semantic" });
    second.addEdge({ from: "two.md", to: "shared.md", type: "semantic", weight: 0.8, relation: "semantic" });
    await first.save(adapter);
    await second.save(adapter);

    expect(adapter.files.has("sanctum-logs/index/one/kg-edges.jsonl")).toBe(true);
    expect(adapter.files.has("sanctum-logs/index/two/kg-edges.jsonl")).toBe(true);
    expect(adapter.files.get("sanctum-logs/index/one/kg-edges.jsonl")).not.toContain("two.md");
  });
});
