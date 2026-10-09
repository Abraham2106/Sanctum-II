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
    expect(store.getEdge("disk.md", "x.md")).toBeDefined();
    expect(store.count).toBe(2);
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
    const loading = store.load(readOnly);
    store.addEdge({ from: "local.md", to: "y.md", type: "semantic", weight: 1, relation: "semantic" });
    releaseRead();
    await loading;
    expect(store.getEdge("local.md", "y.md")).toBeDefined();
    expect(store.getEdge("disk.md", "x.md")).toBeDefined();
    expect(store.count).toBe(2);
    expect(writes).toBe(0);
    await store.save({
      read: readOnly.read,
      write: async () => { writes++; },
    });
    expect(writes).toBe(1);
  });

  it("merges disk baseline with concurrent edge add and persists both", async () => {
    const files = new Map<string, string>();
    files.set(
      "kg-merge.jsonl",
      '{"t":"set","from":"disk.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n'
    );
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
    const store = new KgEdgeStore("kg-merge.jsonl");
    const loading = store.load(adapter);
    store.addEdge({ from: "local.md", to: "y.md", type: "semantic", weight: 1, relation: "semantic" });
    releaseRead();
    await loading;
    await store.save(adapter);
    const reloaded = new KgEdgeStore("kg-merge.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(2);
  });

  it("keeps pre-load unsaved edges alongside disk baseline after load", async () => {
    const files = new Map<string, string>();
    files.set(
      "kg-preload.jsonl",
      '{"t":"set","from":"disk.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n'
    );
    const adapter = {
      read: async (p: string) => files.get(p) ?? "",
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    const store = new KgEdgeStore("kg-preload.jsonl");
    store.addEdge({ from: "local.md", to: "y.md", type: "semantic", weight: 1, relation: "semantic" });
    await store.load(adapter);
    expect(store.count).toBe(2);
    await store.save(adapter);
    const reloaded = new KgEdgeStore("kg-preload.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(2);
  });

  it("removes disk-only edges deleted before load completes", async () => {
    const line = '{"t":"set","from":"drop.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n';
    let disk = line;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async () => {
        await readGate;
        return disk;
      },
      write: async (_: string, c: string) => { disk = c; },
      append: async (_: string, c: string) => { disk += c; },
    };
    const store = new KgEdgeStore("del-before.jsonl");
    const loading = store.load(adapter);
    store.delEdge("drop.md", "x.md");
    releaseRead();
    await loading;
    expect(store.count).toBe(0);
    await store.save(adapter);
    const reloaded = new KgEdgeStore("del-before.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(0);
  });

  it("removes disk edges deleted locally during load", async () => {
    const line = '{"t":"set","from":"drop.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n';
    let disk = line;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async () => {
        await readGate;
        return disk;
      },
      write: async (_: string, c: string) => { disk = c; },
      append: async (_: string, c: string) => { disk += c; },
    };
    const store = new KgEdgeStore("del-race.jsonl");
    store.addEdge({ from: "drop.md", to: "x.md", type: "semantic", weight: 1, relation: "semantic" });
    const loading = store.load(adapter);
    store.delEdge("drop.md", "x.md");
    releaseRead();
    await loading;
    expect(store.getEdge("drop.md", "x.md")).toBeUndefined();
    expect(store.count).toBe(0);
    await store.save(adapter);
    const reloaded = new KgEdgeStore("del-race.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(0);
  });

  it("clears disk edges for a note via delAllEdgesForNote during load", async () => {
    const line =
      '{"t":"set","from":"note.md","to":"a.md","typ":"semantic","w":1,"r":"semantic"}\n' +
      '{"t":"set","from":"note.md","to":"b.md","typ":"semantic","w":1,"r":"semantic"}\n';
    let disk = line;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async () => {
        await readGate;
        return disk;
      },
      write: async (_: string, c: string) => { disk = c; },
      append: async (_: string, c: string) => { disk += c; },
    };
    const store = new KgEdgeStore("del-all.jsonl");
    const loading = store.load(adapter);
    store.delAllEdgesForNote("note.md");
    store.addEdge({ from: "fresh.md", to: "c.md", type: "semantic", weight: 1, relation: "semantic" });
    releaseRead();
    await loading;
    expect(store.count).toBe(1);
    expect(store.getEdge("fresh.md", "c.md")).toBeDefined();
    await store.save(adapter);
    const reloaded = new KgEdgeStore("del-all.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(1);
  });

  it("keeps pending intents across consecutive racing loads", async () => {
    const files = new Map<string, string>();
    files.set(
      "kg-twice.jsonl",
      '{"t":"set","from":"disk.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n'
    );
    let release1!: () => void;
    let release2!: () => void;
    const gate1 = new Promise<void>((r) => { release1 = r; });
    const gate2 = new Promise<void>((r) => { release2 = r; });
    let pass = 0;
    const adapter = {
      read: async (p: string) => {
        if (pass === 0) {
          pass++;
          await gate1;
        } else {
          await gate2;
        }
        return files.get(p) ?? "";
      },
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    const store = new KgEdgeStore("kg-twice.jsonl");
    const first = store.load(adapter);
    store.addEdge({ from: "l1.md", to: "y.md", type: "semantic", weight: 1, relation: "semantic" });
    release1();
    await first;
    const second = store.load(adapter);
    store.addEdge({ from: "l2.md", to: "z.md", type: "semantic", weight: 1, relation: "semantic" });
    release2();
    await second;
    expect(store.count).toBe(3);
  });

  it("retries load after IO failure without losing pending ops", async () => {
    const files = new Map<string, string>();
    files.set(
      "kg-retry.jsonl",
      '{"t":"set","from":"disk.md","to":"x.md","typ":"semantic","w":1,"r":"semantic"}\n'
    );
    let fail = true;
    const adapter = {
      read: async (p: string) => {
        if (fail) throw new Error("EIO");
        return files.get(p) ?? "";
      },
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    const store = new KgEdgeStore("kg-retry.jsonl");
    store.addEdge({ from: "local.md", to: "y.md", type: "semantic", weight: 1, relation: "semantic" });
    await expect(store.load(adapter)).rejects.toThrow("EIO");
    expect(store.count).toBe(1);
    fail = false;
    await store.load(adapter);
    expect(store.count).toBe(2);
  });

  it("does not replay stale local ops after save when disk changes externally", async () => {
    const files = new Map<string, string>();
    const path = "kg-stale.jsonl";
    const adapter = {
      read: async (p: string) => files.get(p) ?? "",
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    const store = new KgEdgeStore(path);
    store.addEdge({ from: "local.md", to: "y.md", type: "semantic", weight: 1, relation: "semantic" });
    await store.save(adapter);
    files.set(
      path,
      '{"t":"set","from":"fresh-disk.md","to":"z.md","typ":"semantic","w":1,"r":"semantic"}\n'
    );
    await store.load(adapter);
    expect(store.count).toBe(1);
    expect(store.getEdge("fresh-disk.md", "z.md")).toBeDefined();
    expect(store.getEdge("local.md", "y.md")).toBeUndefined();
  });

  it("persists delete-all on disk-only note before add in call order", async () => {
    const line =
      '{"t":"set","from":"note.md","to":"a.md","typ":"semantic","w":1,"r":"semantic"}\n' +
      '{"t":"set","from":"note.md","to":"b.md","typ":"semantic","w":1,"r":"semantic"}\n';
    let disk = line;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async () => {
        await readGate;
        return disk;
      },
      write: async (_: string, c: string) => { disk = c; },
      append: async (_: string, c: string) => { disk += c; },
    };
    const store = new KgEdgeStore("kg-order.jsonl");
    const loading = store.load(adapter);
    store.delAllEdgesForNote("note.md");
    store.addEdge({ from: "note.md", to: "c.md", type: "semantic", weight: 1, relation: "semantic" });
    releaseRead();
    await loading;
    await store.save(adapter);
    const reloaded = new KgEdgeStore("kg-order.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(1);
    expect(reloaded.getEdge("note.md", "c.md")).toBeDefined();
  });

  it("does not duplicate durable lines across consecutive loads after save", async () => {
    const files = new Map<string, string>();
    const path = "kg-dup-load.jsonl";
    const adapter = {
      read: async (p: string) => files.get(p) ?? "",
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    const store = new KgEdgeStore(path);
    store.addEdge({ from: "a.md", to: "b.md", type: "semantic", weight: 1, relation: "semantic" });
    await store.save(adapter);
    const before = (files.get(path) ?? "").trim().split("\n").filter(Boolean).length;
    await store.load(adapter);
    await store.load(adapter);
    await store.save(adapter);
    const after = (files.get(path) ?? "").trim().split("\n").filter(Boolean).length;
    expect(after).toBe(before);
  });

  it("delayed save retires replay prefix without duplicating when a new op arrives", async () => {
    const adapter = deferredAdapter();
    const path = "kg-delay.jsonl";
    const release = adapter.holdAppend(path);
    const store = new KgEdgeStore(path);
    store.addEdge({ from: "a.md", to: "b.md", type: "semantic", weight: 1, relation: "semantic" });
    const first = store.save(adapter);
    store.addEdge({ from: "c.md", to: "d.md", type: "semantic", weight: 1, relation: "semantic" });
    release();
    await first;
    await store.save(adapter);
    const lines = (adapter.files.get(path) ?? "").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
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
