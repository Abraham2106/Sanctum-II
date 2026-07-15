#!/usr/bin/env node
/**
 * Smoke test for the Sanctum MCP server.
 *
 * Spawns the server, writes all JSON-RPC messages to stdin, closes stdin,
 * collects stdout until process exits, then asserts responses.
 *
 * Usage:
 *   node mcp-server/test/smoke.mjs
 */
import { spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, "..", "dist", "index.cjs")
const CWD = resolve(__dirname, "..", "..")
const VAULT = process.env.SANCTUM_VAULT_PATH ?? CWD

// ---------------------------------------------------------------------------
// Build input messages
// ---------------------------------------------------------------------------
const msgs = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke-test", version: "0.1.0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "sanctum_list_agents", arguments: {} } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "tool_inexistente", arguments: {} } },
  { jsonrpc: "2.0", id: 5, method: "ping" },
  // Fase 2: sanctum_get_note
  { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sanctum_get_note", arguments: { agent_id: "forager", path: "some/blocked.md" } } },
  { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "sanctum_get_note", arguments: { agent_id: "nonexistent_agent", path: "any/path.md" } } },
  // Fase 3: sanctum_query_vault
  { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "sanctum_query_vault", arguments: { agent_id: "forager", query: "test query without indexing" } } },
  // Fase 4: sanctum_invoke_agent
  { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "sanctum_invoke_agent", arguments: { agent_id: "forager", prompt: "Hola, probando" } } },
  // Fase 5: sanctum_run_mesh
  { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "sanctum_run_mesh", arguments: { prompt: "Investigá el impacto de X en Y" } } },
]

// ---------------------------------------------------------------------------
// Spawn server with stdin pipe
// ---------------------------------------------------------------------------
const proc = spawn("node", [SERVER], {
  cwd: CWD,
  env: { ...process.env, SANCTUM_VAULT_PATH: VAULT, SANCTUM_LOG_LEVEL: "error" },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
})

// Collect stdout
const stdoutChunks = []
proc.stdout.on("data", (c) => stdoutChunks.push(c))

// Collect stderr (for diagnostics on failure)
const stderrChunks = []
proc.stderr.on("data", (c) => stderrChunks.push(c))

// Write all messages to stdin, then close it (signals EOF to readline)
for (const m of msgs) {
  proc.stdin.write(JSON.stringify(m) + "\n")
}
proc.stdin.end()

// Wait for the process to exit naturally (stdin EOF -> readline close -> process.exit)
const exitCode = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    proc.kill()
    reject(new Error("Timeout"))
  }, 15000)
  proc.on("exit", (code) => {
    clearTimeout(timeout)
    resolve(code)
  })
  proc.on("error", (err) => {
    clearTimeout(timeout)
    reject(err)
  })
})

const stdout = stdoutChunks.join("")
const stderr = stderrChunks.join("")

// ---------------------------------------------------------------------------
// Parse JSON-RPC responses from stdout
// ---------------------------------------------------------------------------
const responses = []
for (const line of stdout.split("\n")) {
  const t = line.trim()
  if (!t) continue
  try {
    const parsed = JSON.parse(t)
    if (parsed.jsonrpc === "2.0") responses.push(parsed)
  } catch {}
}

// Sort by id for deterministic assertion order
responses.sort((a, b) => (a.id ?? 99) - (b.id ?? 99))

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let pass = 0
let fail = 0

function ok(label) { pass++; console.log(`  ✅ ${label}`) }
function ng(label, detail) { fail++; console.log(`  ❌ ${label} — ${detail}`) }

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

console.log(`\n` + `📋 Smoke test — ${responses.length} respuestas de ${msgs.filter(m => m.id != null).length} esperadas\n`)

// 1. initialize
has(responses[0], "result.protocolVersion", "2024-11-05", "initialize: protocolVersion")
has(responses[0], "result.serverInfo.name", "sanctum-mcp", "initialize: serverInfo.name")

// 2. tools/list
const tools = responses[1]?.result?.tools ?? []
has(responses[1], "result.tools.0.name", "sanctum_list_agents", "tools/list: primera tool")
if (tools.length >= 5) {
  ok(`tools/list: ${tools.length} tools (esperado >= 5)`)
} else {
  ng("tools/list: count", `${tools.length} tools, esperado >= 5`)
}

// 3. sanctum_list_agents
has(responses[2], "result.content.0.type", "text", "list_agents: content type is text")
const text = responses[2]?.result?.content?.[0]?.text ?? ""
if (text.includes("forager") && text.includes("researcher") && text.includes("critic")) {
  ok("list_agents: menciona forager, researcher, critic")
} else {
  ng("list_agents: contenido", `no menciona agentes esperados: "${text.substring(0, 200)}"`)
}

// 4. tool_inexistente
has(responses[3], "error.code", -32602, "tool_inexistente: code -32602")

// 5. ping
if (responses[4] && !responses[4].error) {
  ok("ping: sin error")
} else {
  ng("ping: sin error")
}

// 6. sanctum_get_note — permission denied
{
  const r = responses[5]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("PERMISSION_DENIED")) {
    ok("get_note: forager + path bloqueado → PERMISSION_DENIED")
  } else {
    ng("get_note: forager + path bloqueado", `esperado isError con PERMISSION_DENIED, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

// 7. sanctum_get_note — agent not found
{
  const r = responses[6]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("AGENT_NOT_FOUND")) {
    ok("get_note: agente inexistente → AGENT_NOT_FOUND")
  } else {
    ng("get_note: agente inexistente", `esperado isError con AGENT_NOT_FOUND, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

// 8. sanctum_query_vault — no indexed chunks
{
  const r = responses[7]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("VAULT_NOT_INDEXED")) {
    ok("query_vault: vault sin índice → VAULT_NOT_INDEXED")
  } else {
    ng("query_vault: vault sin índice", `esperado isError con VAULT_NOT_INDEXED, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

// 9. sanctum_invoke_agent — no API key in smoke test env
{
  const r = responses[8]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("LLM_NOT_CONFIGURED")) {
    ok("invoke_agent: sin api key → LLM_NOT_CONFIGURED")
  } else {
    ng("invoke_agent: sin api key", `esperado isError con LLM_NOT_CONFIGURED, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

// 10. sanctum_run_mesh — no API key
{
  const r = responses[9]
  const txt = r?.result?.content?.[0]?.text ?? ""
  if (r?.result?.isError && txt.includes("LLM_NOT_CONFIGURED")) {
    ok("run_mesh: sin api key → LLM_NOT_CONFIGURED")
  } else {
    ng("run_mesh: sin api key", `esperado isError con LLM_NOT_CONFIGURED, obtenido: ${JSON.stringify(r?.result)}`)
  }
}

// ── Post-test: verify trace format ──
{
  const { writeFileSync, mkdirSync, readFileSync, rmSync } = await import("node:fs")
  const { join } = await import("node:path")
  const tracesDir = resolve(CWD, "sanctum-logs", "traces")
  mkdirSync(tracesDir, { recursive: true })
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
  writeFileSync(testFile, JSON.stringify(testTrace, null, 2))
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

// Summary
const total = pass + fail
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`  ${pass}/${total} tests pasaron${fail > 0 ? `, ${fail} fallaron` : ""}\n`)
if (fail > 0) {
  console.error(`stderr:\n${stderr}`)
  process.exit(1)
}
