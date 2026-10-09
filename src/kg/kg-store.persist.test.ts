import { describe, expect, it } from "vitest";
import { KgEdgeStore } from "./kg-store";

function deferredAdapter() {
  const files = new Map<string, string>();
  const gates = new Map<string, { release: () => void; gate: Promise<void> }>();
  return {
    files,
    read: async (p: string) => {
      const value = files.get(p);
      if (value === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return value;
    },
    write: async (p: string, c: string) => { files.set(p, c); },
    append: async (p: string, c: string) => {
      const pending = gates.get(`append:${p}`);
      if (pending) await pending.gate;
      files.set(p, (files.get(p) ?? "") + c);
    },
    holdAppend(path: string) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      gates.set(`append:${path}`, { release, gate });
      return release;
    },
    holdRead(path: string) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      gates.set(`read:${path}`, { release, gate });
    },
  };
}

describe("KgEdgeStore pending batch (DEC-0022)", () => {
  it("retains pending transactions when save fails", async () => {
    const files = new Map<string, string>();
    let fail = true;
    const adapter = {
      read: async (p: string) => files.get(p) ?? "",
      write: async (p: string, c: string) => {
        if (fail) throw new Error("fail");
        files.set(p, c);
      },
      append: async (p: string, c: string) => {
        if (fail) throw new Error("fail");
        files.set(p, (files.get(p) ?? "") + c);
      },
    };
    const store = new KgEdgeStore("kg.jsonl");
    store.addEdge({ from: "a.md", to: "b.md", type: "semantic", weight: 1, relation: "semantic" });
    await expect(store.save(adapter)).rejects.toThrow();
    store.addEdge({ from: "b.md", to: "c.md", type: "semantic", weight: 1, relation: "semantic" });
    fail = false;
    await store.save(adapter);
    const loaded = new KgEdgeStore("kg.jsonl");
    await loaded.load(adapter);
    expect(loaded.count).toBe(2);
  });

  it("serializes concurrent saves on the same store path", async () => {
    const adapter = deferredAdapter();
    const path = "kg-serial.jsonl";
    const release = adapter.holdAppend(path);
    const store = new KgEdgeStore(path);
    store.addEdge({ from: "a.md", to: "b.md", type: "semantic", weight: 1, relation: "semantic" });
    const first = store.save(adapter);
    store.addEdge({ from: "c.md", to: "d.md", type: "semantic", weight: 1, relation: "semantic" });
    const second = store.save(adapter);
    release();
    await Promise.all([first, second]);
    const disk = adapter.files.get(path) ?? "";
    const lines = disk.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("keeps truncate intent when clear runs during in-flight save", async () => {
    const adapter = deferredAdapter();
    const path = "kg-clear.jsonl";
    adapter.files.set(path, '{"t":"set","from":"old.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n');
    const store = new KgEdgeStore(path);
    await store.load(adapter);
    store.addEdge({ from: "n.md", to: "m.md", type: "semantic", weight: 1, relation: "semantic" });
    const release = adapter.holdAppend(path);
    const saving = store.save(adapter);
    store.clear();
    store.addEdge({ from: "fresh.md", to: "only.md", type: "semantic", weight: 1, relation: "semantic" });
    release();
    await saving;
    await store.save(adapter);
    const reloaded = new KgEdgeStore(path);
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(1);
    expect(reloaded.getEdge("fresh.md", "only.md")).toBeDefined();
  });

  it("preserves local mutations when load races with add", async () => {
    const files = new Map<string, string>();
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async (p: string) => {
        await readGate;
        return files.get(p) ?? "";
      },
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    files.set("race.jsonl", '{"t":"set","from":"disk.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n');
    const store = new KgEdgeStore("race.jsonl");
    const loading = store.load(adapter);
    store.addEdge({ from: "local.md", to: "y.md", type: "semantic", weight: 1, relation: "semantic" });
    releaseRead();
    await loading;
    expect(store.getEdge("local.md", "y.md")).toBeDefined();
    expect(store.getEdge("disk.md", "x.md")).toBeUndefined();
  });

  it("throws on failed load without wiping in-memory state", async () => {
    const store = new KgEdgeStore("fail.jsonl");
    store.addEdge({ from: "keep.md", to: "z.md", type: "semantic", weight: 1, relation: "semantic" });
    const adapter = {
      read: async () => { throw new Error("EIO disk"); },
      write: async () => {},
    };
    await expect(store.load(adapter)).rejects.toThrow("EIO");
    expect(store.count).toBe(1);
    await expect(store.load(adapter)).rejects.toThrow("EIO");
    expect(store.count).toBe(1);
  });

  it("does not write during load when local state mutates on a read-only adapter", async () => {
    const disk = '{"t":"set","from":"disk.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n';
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    let writes = 0;
    const readOnly = {
      read: async () => {
        await readGate;
        return disk;
      },
    };
    const store = new KgEdgeStore("ro-load.jsonl");
    const loading = store.load(readOnly as unknown as Parameters<KgEdgeStore["load"]>[0]);
    store.addEdge({ from: "local.md", to: "y.md", type: "semantic", weight: 1, relation: "semantic" });
    releaseRead();
    await loading;
    expect(store.getEdge("local.md", "y.md")).toBeDefined();
    expect(store.getEdge("disk.md", "x.md")).toBeUndefined();
    expect(writes).toBe(0);
    await store.save({
      read: readOnly.read,
      write: async () => { writes++; },
    });
    expect(writes).toBe(1);
  });

  it("does not overwrite on append fallback read failure", async () => {
    const files = new Map<string, string>();
    const adapter = {
      read: async () => { throw new Error("permission denied"); },
      write: async (p: string, c: string) => { files.set(p, c); },
    };
    const store = new KgEdgeStore("ro.jsonl");
    store.addEdge({ from: "a.md", to: "b.md", type: "semantic", weight: 1, relation: "semantic" });
    await expect(store.save(adapter)).rejects.toThrow(/permission/);
    expect(files.has("ro.jsonl")).toBe(false);
  });
});
