import { promises as fs } from "node:fs"
import path from "node:path"
import type { VaultAdapter } from "../../../src/core/vault-adapter.js"
import { log } from "../mcp/logger.js"

const FORBIDDEN_SEGMENTS = new Set([
  ".env", ".git", "node_modules", ".obsidian",
])

export class FsVaultAdapter implements VaultAdapter {
  constructor(private root: string) {}

  private async resolveSecure(p: string): Promise<string> {
    if (!p || p.includes("\0")) {
      throw Object.assign(new Error("Invalid path: empty or contains null byte"), { code: "EACCES" })
    }
    if (path.isAbsolute(p)) {
      throw Object.assign(new Error("Access denied: absolute paths not allowed"), { code: "EACCES" })
    }
    const segments = p.split(/[/\\]/)
    if (segments.includes("..")) {
      throw Object.assign(new Error("Access denied: path traversal not allowed"), { code: "EACCES" })
    }
    for (const seg of segments) {
      if (FORBIDDEN_SEGMENTS.has(seg.toLowerCase())) {
        throw Object.assign(new Error("Access denied: forbidden path segment"), { code: "EACCES" })
      }
    }

    const resolved = path.resolve(this.root, p)
    const normalizedRoot = path.resolve(this.root)

    if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
      throw Object.assign(new Error("Access denied: path escapes vault root"), { code: "EACCES" })
    }

    const realRoot = await fs.realpath(normalizedRoot)
    let probe = resolved
    let realProbe: string | undefined
    while (true) {
      try {
        realProbe = await fs.realpath(probe)
        break
      } catch (err: any) {
        if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err
        const parent = path.dirname(probe)
        if (parent === probe) throw err
        probe = parent
      }
    }
    const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep
    const comparable = process.platform === "win32"
      ? (value: string) => value.toLowerCase()
      : (value: string) => value
    const rootForCompare = comparable(realRoot)
    const probeForCompare = comparable(realProbe)
    if (probeForCompare !== rootForCompare && !probeForCompare.startsWith(comparable(rootPrefix))) {
      throw Object.assign(new Error("Access denied: symlink escapes vault root"), { code: "EACCES" })
    }

    return resolved
  }

  async read(p: string): Promise<string> {
    const full = await this.resolveSecure(p)
    return fs.readFile(full, "utf8")
  }

  async write(p: string, data: string): Promise<void> {
    const full = await this.resolveSecure(p)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, data, "utf8")
  }

  async mkdir(p: string): Promise<void> {
    const full = await this.resolveSecure(p)
    await fs.mkdir(full, { recursive: true })
  }

  async list(p: string): Promise<{ files: string[]; folders: string[] }> {
    const full = await this.resolveSecure(p)
    const files: string[] = []
    const folders: string[] = []
    let entries
    try {
      entries = await fs.readdir(full, { withFileTypes: true })
    } catch {
      log.warn("no se pudo leer el directorio", { path: full })
      return { files, folders }
    }
    for (const e of entries) {
      const childPath = path.posix.join(p, e.name)
      if (e.isDirectory()) {
        folders.push(childPath)
      } else {
        files.push(childPath)
      }
    }
    return { files, folders }
  }

  async exists(p: string): Promise<boolean> {
    try {
      const full = await this.resolveSecure(p)
      await fs.access(full)
      return true
    } catch {
      return false
    }
  }

  async append(p: string, data: string): Promise<void> {
    const full = await this.resolveSecure(p)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.appendFile(full, data, "utf8")
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldFull = await this.resolveSecure(oldPath)
    const newFull = await this.resolveSecure(newPath)
    await fs.mkdir(path.dirname(newFull), { recursive: true })
    await fs.rename(oldFull, newFull)
  }

  async remove(p: string): Promise<void> {
    const full = await this.resolveSecure(p)
    await fs.rm(full, { force: true })
  }
}
