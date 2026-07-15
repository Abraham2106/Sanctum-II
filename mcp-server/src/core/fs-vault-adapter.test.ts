import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsVaultAdapter } from "./fs-vault-adapter";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("FsVaultAdapter confinement", () => {
  it("uses the vault-resolved path for exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sanctum-vault-"));
    tempRoots.push(root);
    await fs.writeFile(path.join(root, "inside.txt"), "ok");
    const adapter = new FsVaultAdapter(root);

    await expect(adapter.read("inside.txt")).resolves.toBe("ok");
    await expect(adapter.exists("inside.txt")).resolves.toBe(true);
  });

  it("rejects forbidden segments case-insensitively", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sanctum-vault-"));
    tempRoots.push(root);
    const adapter = new FsVaultAdapter(root);

    await expect(adapter.read(".GIT/config")).rejects.toMatchObject({ code: "EACCES" });
    await expect(adapter.read(".ENV")).rejects.toMatchObject({ code: "EACCES" });
  });
});
