#!/usr/bin/env node
/**
 * Portable HTTP MCP launcher (DEC-0022). Sets SANCTUM_MCP_HTTP and starts the server.
 * Works on Windows and Linux/macOS without POSIX env-prefix syntax.
 */
import { spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tsxCli = resolve(root, "node_modules", "tsx", "dist", "cli.mjs")

const env = {
  ...process.env,
  SANCTUM_MCP_HTTP: "1",
}

const child = spawn(process.execPath, [tsxCli, resolve(root, "mcp-server", "index.ts")], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: true,
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on("error", (err) => {
  console.error(err)
  process.exit(1)
})
