import { describe, expect, it } from "vitest";
import { ensureVaultDirectory } from "./core/vault-fs";

describe("ensureVaultDirectory", () => {
  it("creates every missing parent on an Obsidian-like adapter", async () => {
    const dirs = new Set<string>();
    const adapter = {
      exists: async (path: string) => dirs.has(path),
      mkdir: async (path: string) => {
        const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (parent && !dirs.has(parent)) throw Object.assign(new Error("parent missing"), { code: "ENOENT" });
        dirs.add(path);
      },
    };

    await ensureVaultDirectory(adapter, "sanctum-logs/index/q-optimization");
    expect([...dirs]).toEqual([
      "sanctum-logs",
      "sanctum-logs/index",
      "sanctum-logs/index/q-optimization",
    ]);
    await ensureVaultDirectory(adapter, "sanctum-logs/index/q-optimization");
    expect(dirs.size).toBe(3);
  });

  it("rejects traversal paths", async () => {
    await expect(ensureVaultDirectory({ exists: async () => false, mkdir: async () => {} }, "a/../b"))
      .rejects.toThrow("Invalid vault directory path");
  });
});
