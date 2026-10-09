#!/usr/bin/env node
/**
 * Full verification pipeline for CI and local runs (T-044 / DEC-0022).
 * No live API keys, model downloads, or private vault data required.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

function run(label, command, args, extraEnv = {}) {
  console.log(`\n▶ ${label}`)
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: process.platform === "win32",
  })
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${result.status ?? "unknown"})`)
    process.exit(result.status ?? 1)
  }
}

function findPython() {
  for (const cmd of ["python", "python3"]) {
    const probe = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: true })
    if (probe.status === 0) return cmd
  }
  return null
}

function orchestrationRunner() {
  const script = "orchestration/tests/Run-OrchestrationTests.ps1"
  if (process.platform === "win32") {
    return { cmd: "powershell", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] }
  }
  if (spawnSync("pwsh", ["-Version"], { encoding: "utf8", shell: true }).status === 0) {
    return { cmd: "pwsh", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] }
  }
  return null
}

console.log("Sanctum II verify — synthetic / contract tests only")

run("typecheck", "npm", ["run", "typecheck"])
run("vitest", "npx", ["vitest", "run"])
run("knowledge-graph (tsx)", "node", ["--import", "tsx", "src/kg/kg.test.ts"])

const orch = orchestrationRunner()
if (orch) {
  run("orchestration (PowerShell)", orch.cmd, orch.args)
} else {
  console.log("\n▶ orchestration (PowerShell)")
  console.log("SKIP: pwsh/powershell not available; orchestration tests not run on this host")
}

const py = findPython()
if (py) {
  run(
    "local-embeddings unittest",
    py,
    ["-m", "unittest", "discover", "-s", "local-embeddings", "-p", "test_*.py"],
  )
} else {
  console.log("\n▶ local-embeddings unittest")
  console.log("SKIP: Python not available; skipping local-embeddings contract tests")
}

run("production build", "npm", ["run", "build"])

const serverBundle = "mcp-server/dist/index.cjs"
if (!existsSync(serverBundle)) {
  console.error(`Missing ${serverBundle} after build`)
  process.exit(1)
}

run("MCP smoke (isolated fixture vault)", "node", ["mcp-server/test/smoke.mjs"])

console.log("\n✓ verify completed")
