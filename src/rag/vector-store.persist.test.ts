import { describe, expect, it } from "vitest";
import { VectorStore, type Chunk } from "./vector-store";

function chunk(id: string, path: string): Chunk {
  return { id, note_path: path, chunk_text: id, embedding: [1, 0] };
}

describe("VectorStore pending batch (DEC-0022)", () => {
  it("keeps pending batch when append fails and retries on next save", async () => {
    let disk = "";
    let fail = true;
    const adapter = {
      read: async () => disk,
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => {
        if (fail) throw new Error("disk full");
        disk += value;
      },
    };
    const store = new VectorStore("test.jsonl");
    store.addChunks([chunk("a", "n/a.md")]);
    await expect(store.save(adapter)).rejects.toThrow("disk full");
    expect(store.count).toBe(1);

    fail = false;
    await store.save(adapter);
    const loaded = new VectorStore("test.jsonl");
    await loaded.load(adapter);
    expect(loaded.count).toBe(1);
  });

  it("durably persists chunks added during an in-flight append", async () => {
    let disk = "";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      read: async () => disk,
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => {
        await gate;
        disk += value;
      },
    };
    const store = new VectorStore();
    store.addChunks([chunk("a", "Research/a.md")]);
    const saving = store.save(adapter);
    store.addChunks([chunk("b", "Research/b.md")]);
    release();
    await saving;
    await store.save(adapter);
    const loaded = new VectorStore();
    await loaded.load(adapter);
    expect(loaded.count).toBe(2);
  });

  it("clears pending on load after clear/save lifecycle", async () => {
    const files = new Map<string, string>();
    const adapter = {
      read: async (p: string) => files.get(p) ?? "",
      write: async (p: string, c: string) => { files.set(p, c); },
    };
    const store = new VectorStore("vs.jsonl");
    store.addChunks([chunk("x", "a.md")]);
    await store.save(adapter);
    store.clear();
    store.addChunks([chunk("y", "b.md")]);
    await store.save(adapter);
    const reloaded = new VectorStore("vs.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(1);
    expect(reloaded.allChunks[0].id).toBe("y");
  });

  it("serializes concurrent saves so append batches are not duplicated", async () => {
    let disk = "";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      read: async () => disk,
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => {
        await gate;
        disk += value;
      },
    };
    const store = new VectorStore("dup.jsonl");
    store.addChunks([chunk("a", "n/a.md")]);
    const first = store.save(adapter);
    store.addChunks([chunk("b", "n/b.md")]);
    const second = store.save(adapter);
    release();
    await Promise.all([first, second]);
    const lines = disk.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("keeps truncate after clear during in-flight append save", async () => {
    let disk = "stale\n";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      read: async () => disk,
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => {
        await gate;
        disk += value;
      },
    };
    const store = new VectorStore("trunc.jsonl");
    store.addChunks([chunk("old", "a.md")]);
    const saving = store.save(adapter);
    store.clear();
    store.addChunks([chunk("new", "b.md")]);
    release();
    await saving;
    await store.save(adapter);
    const reloaded = new VectorStore("trunc.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(1);
    expect(reloaded.allChunks[0].id).toBe("new");
  });

  it("preserves in-memory chunks when load fails repeatedly", async () => {
    const store = new VectorStore("retry.jsonl");
    store.addChunks([chunk("local", "x.md")]);
    const adapter = {
      read: async () => { throw new Error("EIO"); },
      write: async () => {},
    };
    await expect(store.load(adapter)).rejects.toThrow("EIO");
    expect(store.count).toBe(1);
    await expect(store.load(adapter)).rejects.toThrow("EIO");
    expect(store.allChunks[0].id).toBe("local");
  });

  it("does not write during load when local state mutates on a read-only adapter", async () => {
    let disk = '{"t":"set","id":"disk","p":"d.md","txt":"d","v":"AACAPwAAAD8="}\n';
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    let writes = 0;
    const readOnly = {
      read: async () => {
        await readGate;
        return disk;
      },
    };
    const store = new VectorStore("ro-load.jsonl");
    const loading = store.load(readOnly as unknown as Parameters<VectorStore["load"]>[0]);
    store.addChunks([chunk("local", "l.md")]);
    releaseRead();
    await loading;
    expect(store.count).toBe(1);
    expect(store.allChunks[0].id).toBe("local");
    expect(writes).toBe(0);
    await store.save({
      read: readOnly.read,
      write: async () => { writes++; },
    });
    expect(writes).toBe(1);
  });

  it("rejects append save when read-before-write fails", async () => {
    let disk = "keep\n";
    const adapter = {
      read: async () => { throw new Error("read denied"); },
      write: async (_: string, value: string) => { disk = value; },
    };
    const store = new VectorStore("readfail.jsonl");
    store.addChunks([chunk("a", "n.md")]);
    await expect(store.save(adapter)).rejects.toThrow(/read denied/);
    expect(disk).toBe("keep\n");
  });
});
