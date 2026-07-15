import { describe, expect, it } from "vitest";
import { ProjectStore } from "./projects/store";
import { Tracer } from "./observability/tracer";

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
});
