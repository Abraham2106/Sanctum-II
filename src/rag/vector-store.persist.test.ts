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
    const loading = store.load(readOnly);
    store.addChunks([chunk("local", "l.md")]);
    releaseRead();
    await loading;
    expect(store.count).toBe(2);
    expect(store.allChunks.map((c) => c.id).sort()).toEqual(["disk", "local"]);
    expect(writes).toBe(0);
    await store.save({
      read: readOnly.read,
      write: async () => { writes++; },
    });
    expect(writes).toBe(1);
  });

  it("merges disk baseline with local adds during load and survives save/reload", async () => {
    const files = new Map<string, string>();
    const diskChunk = JSON.stringify({
      t: "set", id: "disk-old", p: "keep.md", txt: "k", v: "AACAPwAAAD8=",
    }) + "\n";
    files.set("merge.jsonl", diskChunk);
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async (p: string) => {
        await readGate;
        const v = files.get(p);
        if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return v;
      },
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    const store = new VectorStore("merge.jsonl");
    const loading = store.load(adapter);
    store.addChunks([chunk("local-new", "fresh.md")]);
    releaseRead();
    await loading;
    expect(store.count).toBe(2);
    await store.save(adapter);
    const reloaded = new VectorStore("merge.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(2);
    expect(reloaded.allChunks.map((c) => c.id).sort()).toEqual(["disk-old", "local-new"]);
  });

  it("keeps pre-load unsaved chunks alongside disk baseline after load", async () => {
    const files = new Map<string, string>();
    files.set(
      "preload.jsonl",
      JSON.stringify({ t: "set", id: "disk-old", p: "keep.md", txt: "k", v: "AACAPwAAAD8=" }) + "\n"
    );
    const adapter = {
      read: async (p: string) => files.get(p) ?? "",
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    const store = new VectorStore("preload.jsonl");
    store.addChunks([chunk("local-unsaved", "fresh.md")]);
    await store.load(adapter);
    expect(store.count).toBe(2);
    expect(store.allChunks.map((c) => c.id).sort()).toEqual(["disk-old", "local-unsaved"]);
    await store.save(adapter);
    const reloaded = new VectorStore("preload.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(2);
  });

  it("drops historical chunks for a note replaced during load", async () => {
    const hist = JSON.stringify({
      t: "set", id: "hist", p: "note.md", txt: "old", v: "AACAPwAAAD8=",
    }) + "\n";
    const other = JSON.stringify({
      t: "set", id: "other", p: "other.md", txt: "o", v: "AACAPwAAAD8=",
    }) + "\n";
    let disk = hist + other;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async () => {
        await readGate;
        return disk;
      },
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => { disk += value; },
    };
    const store = new VectorStore("replace.jsonl");
    const loading = store.load(adapter);
    store.addChunks([chunk("replacement", "note.md")]);
    releaseRead();
    await loading;
    expect(store.count).toBe(2);
    expect(store.allChunks.map((c) => c.id).sort()).toEqual(["other", "replacement"]);
    await store.save(adapter);
    const reloaded = new VectorStore("replace.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.allChunks.map((c) => c.id).sort()).toEqual(["other", "replacement"]);
  });

  it("deletes a disk-only note when replaced with an empty chunk set", async () => {
    const hist = JSON.stringify({
      t: "set", id: "hist", p: "gone.md", txt: "old", v: "AACAPwAAAD8=",
    }) + "\n";
    let disk = hist;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async () => {
        await readGate;
        return disk;
      },
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => { disk += value; },
    };
    const store = new VectorStore("empty-replace.jsonl");
    const loading = store.load(adapter);
    store.addChunks([], "gone.md");
    releaseRead();
    await loading;
    expect(store.count).toBe(0);
    await store.save(adapter);
    const reloaded = new VectorStore("empty-replace.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(0);
  });

  it("keeps concurrent pending intents across a second racing load", async () => {
    const files = new Map<string, string>();
    files.set(
      "twice.jsonl",
      JSON.stringify({ t: "set", id: "disk", p: "d.md", txt: "d", v: "AACAPwAAAD8=" }) + "\n"
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
    const store = new VectorStore("twice.jsonl");
    const first = store.load(adapter);
    store.addChunks([chunk("local", "l.md")]);
    release1();
    await first;
    const second = store.load(adapter);
    store.addChunks([chunk("local2", "l2.md")]);
    release2();
    await second;
    expect(store.allChunks.map((c) => c.id).sort()).toEqual(["disk", "local", "local2"]);
  });

  it("serializes queued load after save without dropping new pending ops", async () => {
    let disk = "";
    let releaseAppend!: () => void;
    const appendGate = new Promise<void>((r) => { releaseAppend = r; });
    const adapter = {
      read: async () => disk,
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => {
        await appendGate;
        disk += value;
      },
    };
    const store = new VectorStore("qsave-load.jsonl");
    store.addChunks([chunk("a", "a.md")]);
    const saving = store.save(adapter);
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const readAdapter = {
      read: async () => {
        await readGate;
        return disk;
      },
    };
    const loading = store.load(readAdapter);
    store.addChunks([chunk("b", "b.md")]);
    releaseAppend();
    await saving;
    releaseRead();
    await loading;
    expect(store.allChunks.map((c) => c.id).sort()).toEqual(["a", "b"]);
    await store.save(adapter);
  });

  it("honors clear during load without resurrecting disk history", async () => {
    const files = new Map<string, string>();
    files.set(
      "clear-race.jsonl",
      JSON.stringify({ t: "set", id: "gone", p: "a.md", txt: "x", v: "AACAPwAAAD8=" }) + "\n"
    );
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async (p: string) => {
        await readGate;
        return files.get(p) ?? "";
      },
      write: async (p: string, c: string) => { files.set(p, c); },
    };
    const store = new VectorStore("clear-race.jsonl");
    const loading = store.load(adapter);
    store.clear();
    store.addChunks([chunk("after-clear", "b.md")]);
    releaseRead();
    await loading;
    expect(store.count).toBe(1);
    expect(store.allChunks[0].id).toBe("after-clear");
    await store.save(adapter);
    const reloaded = new VectorStore("clear-race.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(1);
    expect(reloaded.allChunks[0].id).toBe("after-clear");
  });

  it("does not replay stale local ops after save when disk changes externally", async () => {
    let disk = "";
    const adapter = {
      read: async () => disk,
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => { disk += value; },
    };
    const store = new VectorStore("stale.jsonl");
    store.addChunks([chunk("local", "l.md")]);
    await store.save(adapter);
    disk = JSON.stringify({ t: "set", id: "fresh", p: "f.md", txt: "f", v: "AACAPwAAAD8=" }) + "\n";
    await store.load(adapter);
    expect(store.count).toBe(1);
    expect(store.allChunks[0].id).toBe("fresh");
  });

  it("keeps newest payload when the same chunk id is replaced twice before load", async () => {
    const hist = JSON.stringify({
      t: "set", id: "reuse", p: "note.md", txt: "v1", v: "AACAPwAAAD8=",
    }) + "\n";
    let disk = hist;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => { releaseRead = r; });
    const adapter = {
      read: async () => {
        await readGate;
        return disk;
      },
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => { disk += value; },
    };
    const store = new VectorStore("reuse.jsonl");
    const loading = store.load(adapter);
    const v2: Chunk = { id: "reuse", note_path: "note.md", chunk_text: "v2", embedding: [0, 1] };
    const v3: Chunk = { id: "reuse", note_path: "note.md", chunk_text: "v3", embedding: [1, 0] };
    store.addChunks([v2]);
    store.addChunks([v3]);
    releaseRead();
    await loading;
    await store.save(adapter);
    const reloaded = new VectorStore("reuse.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(1);
    expect(reloaded.allChunks[0].chunk_text).toBe("v3");
    expect(reloaded.allChunks[0].embedding).toEqual([1, 0]);
  });

  it("deletes disk-only note on save without a prior load", async () => {
    const hist = JSON.stringify({
      t: "set", id: "gone", p: "orphan.md", txt: "old", v: "AACAPwAAAD8=",
    }) + "\n";
    let disk = hist;
    const adapter = {
      read: async () => disk,
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => { disk += value; },
    };
    const store = new VectorStore("no-load-del.jsonl");
    store.addChunks([], "orphan.md");
    await store.save(adapter);
    const reloaded = new VectorStore("no-load-del.jsonl");
    await reloaded.load(adapter);
    expect(reloaded.count).toBe(0);
    expect(reloaded.allChunks.find((c) => c.note_path === "orphan.md")).toBeUndefined();
  });

  it("does not duplicate durable lines across consecutive loads after save", async () => {
    const files = new Map<string, string>();
    const path = "dup-load.jsonl";
    const adapter = {
      read: async (p: string) => files.get(p) ?? "",
      write: async (p: string, c: string) => { files.set(p, c); },
      append: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c); },
    };
    const store = new VectorStore(path);
    store.addChunks([chunk("only", "n.md")]);
    await store.save(adapter);
    const before = (files.get(path) ?? "").trim().split("\n").filter(Boolean).length;
    await store.load(adapter);
    await store.load(adapter);
    await store.save(adapter);
    const after = (files.get(path) ?? "").trim().split("\n").filter(Boolean).length;
    expect(after).toBe(before);
  });

  it("delayed save retires replay prefix without duplicating when a new op arrives", async () => {
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
    const store = new VectorStore("delay.jsonl");
    store.addChunks([chunk("a", "a.md")]);
    const first = store.save(adapter);
    store.addChunks([chunk("b", "b.md")]);
    release();
    await first;
    await store.save(adapter);
    const lines = disk.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
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
