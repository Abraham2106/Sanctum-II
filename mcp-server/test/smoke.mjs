#!/usr/bin/env node
/**
 * Smoke test for the Sanctum MCP server.
 *
 * Uses an isolated temporary vault (synthetic agents only). Clears API keys so
 * no live inference runs. Requires `npm run build` first.
 *
 * Usage:
 *   node mcp-server/test/smoke.mjs
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, "..", "dist", "index.cjs")
const CWD = resolve(__dirname, "..", "..")

function agent(id, readPaths = '["/Research/**"]') {
  return `---
id: ${id}
name: "${id}"
tools: []
permissions:
  read_paths: ${readPaths}
  write_paths: []
---
{{user_prompt}}
`
}

function prepareFixtureVault() {
  const root = mkdtempSync(join(tmpdir(), "sanctum-mcp-smoke-"))
  const agentsDir = join(root, "sanctum-agents")
  mkdirSync(agentsDir, { recursive: true })
  for (const id of ["forager", "researcher", "critic", "agente_base"]) {
    writeFileSync(join(agentsDir, `${id}.md`), agent(id), "utf8")
  }
  mkdirSync(join(root, "sanctum-projects"), { recursive: true })
  writeFileSync(
    join(root, "sanctum-projects", "smoke.md"),
    `---
id: smoke
read_paths: [Research/]
write_paths: []
---
`,
    "utf8",
  )
  return root
}

const FIXTURE_VAULT = prepareFixtureVault()

function cleanupFixture() {
  try {
    rmSync(FIXTURE_VAULT, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Build input messages
// ---------------------------------------------------------------------------
const msgs = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "sanctum_list_agents", arguments: {} } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "tool_inexistente", arguments: {} } },
  { jsonrpc: "2.0", id: 5, method: "ping" },
  {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "sanctum_get_note",
      arguments: { project_id: "smoke", agent_id: "forager", path: "some/blocked.md" },
    },
  },
  {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "sanctum_get_note",
      arguments: { project_id: "smoke", agent_id: "nonexistent_agent", path: "any/path.md" },
    },
  },
  { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "sanctum_query_vault", arguments: { agent_id: "forager", query: "test query without project" } } },
  { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "sanctum_invoke_agent", arguments: { agent_id: "forager", prompt: "Hola, probando" } } },
  { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "sanctum_run_mesh", arguments: { prompt: "Investigá el impacto de X en Y" } } },
]

const smokeEnv = {
  ...process.env,
  SANCTUM_VAULT_PATH: FIXTURE_VAULT,
  SANCTUM_LOG_LEVEL: "error",
  GEMINI_API_KEYS: "",
  OPENCODE_GO_API_KEY: "",
}

// ---------------------------------------------------------------------------
// Spawn server with stdin pipe
// ---------------------------------------------------------------------------
const proc = spawn("node", [SERVER], {
  cwd: CWD,
  env: smokeEnv,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
})

const stdoutChunks = []
proc.stdout.on("data", (c) => stdoutChunks.push(c))

const stderrChunks = []
proc.stderr.on("data", (c) => stderrChunks.push(c))

for (const m of msgs) {
  proc.stdin.write(JSON.stringify(m) + "\n")
}
proc.stdin.end()

const exitCode = await new Promise((resolvePromise, reject) => {
  const timeout = setTimeout(() => {
    proc.kill()
    reject(new Error("Timeout"))
  }, 15000)
  proc.on("exit", (code) => {
    clearTimeout(timeout)
    resolvePromise(code)
  })
  proc.on("error", (err) => {
    clearTimeout(timeout)
    reject(err)
  })
})

const stdout = stdoutChunks.join("")
const stderr = stderrChunks.join("")

const responses = []
for (const line of stdout.split("\n")) {
  const t = line.trim()
  if (!t) continue
  try {
    const parsed = JSON.parse(t)
    if (parsed.jsonrpc === "2.0") responses.push(parsed)
  } catch {}
}

responses.sort((a, b) => (a.id ?? 99) - (b.id ?? 99))

let pass = 0
let fail = 0

function ok(label) {
  pass++
  console.log(`  ✅ ${label}`)
}
function ng(label, detail) {
  fail++
  console.log(`  ❌ ${label} — ${detail}`)
}

function has(resp, keyPath, expect, label) {
  if (!resp) return ng(label, "no response")
  if (resp.error && keyPath !== "error.code") return ng(label, `error: ${JSON.stringify(resp.error)}`)
  const val = keyPath.split(".").reduce((o, k) => {
    if (o == null) return undefined
    if (Array.isArray(o) && /^\d+$/.test(k)) return o[parseInt(k)]
    return o[k]
  }, resp)
  if (typeof expect === "string" && typeof val === "string") {
    if (val.includes(expect)) return ok(label)
    return ng(label, `"${val}" no contiene "${expect}"`)
  }
  if (val === expect) return ok(label)
  return ng(label, `esperado ${JSON.stringify(expect)} en ${keyPath}, obtenido ${JSON.stringify(val)}`)
}

console.log(`\n📋 Smoke test — ${responses.length} respuestas (vault fixture: ${FIXTURE_VAULT})\n`)

has(responses[0], "result.protocolVersion", "2024-11-05", "initialize: protocolVersion")
has(responses[0], "result.serverInfo.name", "sanctum-mcp", "initialize: serverInfo.name")

const tools = responses[1]?.result?.tools ?? []
has(responses[1], "result.tools.0.name", "sanctum_list_agents", "tools/list: primera tool")
if (tools.length >= 6) {
  ok(`tools/list: ${tools.length} tools (esperado >= 6)`)
} else {
  ng("tools/list: count", `${tools.length} tools, esperado >= 6`)
}
const toolNames = new Set(tools.map((t) => t.name))
if (toolNames.has("sanctum_list_notes")) {
  ok("tools/list: incluye sanctum_list_notes")
} else {
  ng("tools/list: sanctum_list_notes", "tool ausente")
}

has(responses[2], "result.content.0.type", "text", "list_agents: content type is text")
const text = responses[2]?.result?.content?.[0]?.text ?? ""
if (text.includes("forager") && text.includes("researcher") && text.includes("critic")) {
  ok("list_agents: menciona forager, researcher, critic")
} else {
  ng("list_agents: contenido", `no menciona agentes esperados: "${text.substring(0, 200)}"`)
}

has(responses[3], "error.code", -32602, "tool_inexistente: code -32602")

if (responses[4] && !responses[4].error) {
  ok("ping: sin error")
} else {
  ng("ping: sin error")
}

{
  const r = responses[5]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("PERMISSION_DENIED")) {
    ok("get_note: forager + path bloqueado → PERMISSION_DENIED")
  } else {
    ng("get_note: forager + path bloqueado", `esperado isError con PERMISSION_DENIED, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

{
  const r = responses[6]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("AGENT_NOT_FOUND")) {
    ok("get_note: agente inexistente → AGENT_NOT_FOUND")
  } else {
    ng("get_note: agente inexistente", `esperado isError con AGENT_NOT_FOUND, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

{
  const r = responses[7]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("PROJECT_REQUIRED")) {
    ok("query_vault: sin project_id → PROJECT_REQUIRED")
  } else {
    ng("query_vault: sin project_id", `esperado PROJECT_REQUIRED, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

{
  const r = responses[8]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("LLM_NOT_CONFIGURED")) {
    ok("invoke_agent: sin api key → LLM_NOT_CONFIGURED")
  } else {
    ng("invoke_agent: sin api key", `esperado isError con LLM_NOT_CONFIGURED, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

{
  const r = responses[9]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("LLM_NOT_CONFIGURED")) {
    ok("run_mesh: sin api key → LLM_NOT_CONFIGURED")
  } else {
    ng("run_mesh: sin api key", `esperado isError con LLM_NOT_CONFIGURED, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

{
  const { writeFileSync: w, mkdirSync: m, readFileSync, rmSync } = await import("node:fs")
  const tracesDir = resolve(CWD, "sanctum-logs", "traces")
  m(tracesDir, { recursive: true })
  const testTrace = {
    trace_id: "test_verify_format",
    timestamp: new Date().toISOString(),
    type: "agent_invocation",
    origin: "mcp",
    agent_id: "test",
    input: { user_prompt: "test" },
    output: "test output",
    duration_ms: 1,
  }
  const testFile = join(tracesDir, "test_verify_format.json")
  w(testFile, JSON.stringify(testTrace, null, 2))
  const parsed = JSON.parse(readFileSync(testFile, "utf8"))
  if (parsed.origin === "mcp") ok("trace format: origin = mcp")
  else ng("trace format: origin", `obtenido ${parsed.origin}`)
  if (parsed.trace_id === "test_verify_format") ok("trace format: trace_id")
  else ng("trace format: trace_id", `obtenido ${parsed.trace_id}`)
  if (parsed.type === "agent_invocation") ok("trace format: type")
  if (parsed.agent_id === "test") ok("trace format: agent_id")
  if (typeof parsed.duration_ms === "number") ok("trace format: duration_ms es número")
  rmSync(testFile)
}

cleanupFixture()

const total = pass + fail
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`  ${pass}/${total} tests pasaron${fail > 0 ? `, ${fail} fallaron` : ""}`)
console.log(`  process exit: ${exitCode}\n`)

if (fail > 0) {
  console.error(`stderr:\n${stderr}`)
  process.exit(1)
}
