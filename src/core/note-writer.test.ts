import { describe, expect, it, vi } from "vitest";
import { NoteWriter } from "./note-writer";
import type { VaultAdapter } from "./vault-adapter";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("NoteWriter (DEC-0022)", () => {
  it("serializes overlapping create and update on the same path", async () => {
    const writes: string[] = [];
    let exists = false;
    const gate = deferred<void>();

    const adapter: VaultAdapter = {
      read: vi.fn(),
      write: vi.fn(async (_path, content) => {
        writes.push(content);
        if (content === "first") {
          await gate.promise;
          exists = true;
        }
      }),
      mkdir: vi.fn(),
      list: vi.fn(async () => ({ files: [], folders: [] })),
      exists: vi.fn(async () => exists),
    };

    const writer = new NoteWriter(adapter);
    const path = "Projects/demo/note.md";

    const createPromise = writer.create(path, "first");
    await Promise.resolve();
    const updatePromise = writer.update(path, "second");
    gate.resolve();

    const [createResult, updateResult] = await Promise.all([createPromise, updatePromise]);

    expect(createResult.action).toBe("created");
    expect(updateResult.action).toBe("updated");
    expect(writes).toEqual(["first", "second"]);
  });
});
