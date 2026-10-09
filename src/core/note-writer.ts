import type { VaultAdapter } from "./vault-adapter";
import { ensureVaultDirectory } from "./vault-fs";
import { withResourceLock } from "./resource-queue"; // DEC-0022

export interface WriteResult {
  success: boolean;
  path: string;
  action: "created" | "updated" | "error";
  message: string;
}

export class NoteWriter {
  constructor(private adapter: VaultAdapter) {}

  /** DEC-0022: one queue per vault note path so overlapping writes cannot drop each other. */
  private noteResourceKey(path: string): string {
    return `note:${path.replace(/\\/g, "/")}`;
  }

  private async ensureDir(filePath: string): Promise<void> {
    const parts = filePath.replace(/\\/g, "/").split("/");
    await ensureVaultDirectory(this.adapter, parts.slice(0, -1).join("/"));
  }

  async create(path: string, content: string): Promise<WriteResult> {
    return withResourceLock(this.adapter, this.noteResourceKey(path), () => this.createUnlocked(path, content));
  }

  private async createUnlocked(path: string, content: string): Promise<WriteResult> {
    const exists = await this.adapter.exists(path);
    if (exists) {
      return {
        success: false,
        path,
        action: "error",
        message: `La nota ya existe: ${path}`,
      };
    }
    await this.ensureDir(path);
    await this.adapter.write(path, content);
    return {
      success: true,
      path,
      action: "created",
      message: `Nota creada: ${path}`,
    };
  }

  async update(path: string, content: string): Promise<WriteResult> {
    return withResourceLock(this.adapter, this.noteResourceKey(path), () => this.updateUnlocked(path, content));
  }

  private async updateUnlocked(path: string, content: string): Promise<WriteResult> {
    const exists = await this.adapter.exists(path);
    if (!exists) {
      return {
        success: false,
        path,
        action: "error",
        message: `La nota no existe: ${path}`,
      };
    }
    await this.ensureDir(path);
    await this.adapter.write(path, content);
    return {
      success: true,
      path,
      action: "updated",
      message: `Nota actualizada: ${path}`,
    };
  }

}
