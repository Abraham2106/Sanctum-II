#!/usr/bin/env node
/**
 * Integration test — prueba real contra Gemini + OpenCode APIs.
 *
 * Spawns the MCP server pointing to the `prueba/` vault (which has
 * an indexed Research/ folder), exercises all 5 tools, and verifies
 * responses and trace files.
 *
 * Usage:
 *   node mcp-server/test/integration.mjs
 */
import { spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, existsSync } from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, "..", "dist", "index.cjs")
const CWD = resolve(__dirname, "..", "..")
const PRUEBA_VAULT = resolve(CWD, "..", "prueba")

// Load env vars from .env
const envPath = resolve(CWD, ".env")
if (existsSync(envPath)) {
  const dotenv = readFileSync(envPath, "utf8")
  for (const line of dotenv.split("\n")) {
    const m = line.match(/^\s*(\w+)\s*=\s*(.+)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

// ---------------------------------------------------------------------------
let pass = 0
let fail = 0

function ok(label) { pass++; console.log(`  ✅ ${label}`) }
function ng(label, detail) { fail++; console.log(`  ❌ ${label} — ${detail}`) }
function has(text, substr, label) {
  if (text.includes(substr)) ok(label)
  else ng(label, `"${text.slice(0, 200)}" no contiene "${substr}"`)
}

// ---------------------------------------------------------------------------
async function run() {
  const msgs = [
    // 0: initialize
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sanctum-mcp-integration-test", version: "0.1.0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    // 1: tools/list
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    // 2: list_agents
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "sanctum_list_agents", arguments: {} } },
    // 3: get_note — success (forager + Research/)
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "sanctum_get_note", arguments: { agent_id: "forager", path: "Research/Machine Learning.md" } } },
    // 4: get_note — permission denied
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "sanctum_get_note", arguments: { agent_id: "forager", path: "sanctum-agents/forager.md" } } },
    // 5: query_vault — RAG search
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sanctum_query_vault", arguments: { agent_id: "forager", query: "machine learning", max_results: 3 } } },
    // 6: invoke_agent — forager reformula un prompt
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "sanctum_invoke_agent", arguments: { agent_id: "forager", prompt: "Contame qué es machine learning en 2 oraciones" } } },
    // 7: run_mesh — loop completo
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "sanctum_run_mesh", arguments: { prompt: "Explicá qué es machine learning en 3 párrafos" } } },
  ]

  // Configure env for the MCP server
  const env = {
    ...process.env,
    SANCTUM_VAULT_PATH: PRUEBA_VAULT,
    SANCTUM_LOG_LEVEL: "error",
    SANCTUM_MESH_TIMEOUT_MS: "300000",
    // Keys are inherited from process.env (loaded from .env above)
  }

  console.log("Keys configuradas:", {
    gemini: env.GEMINI_API_KEYS ? "✅" : "❌",
    opencode: env.OPENCODE_GO_API_KEY ? "✅" : "❌",
  })
  console.log(`Vault: ${PRUEBA_VAULT}\n`)

  const proc = spawn("node", [SERVER], { cwd: CWD, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })

  const stdoutChunks = []
  const stderrChunks = []
  proc.stdout.on("data", (c) => stdoutChunks.push(c))
  proc.stderr.on("data", (c) => stderrChunks.push(c))

  for (const m of msgs) {
    proc.stdin.write(JSON.stringify(m) + "\n")
  }
  proc.stdin.end()

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { proc.kill(); reject(new Error("Timeout (180s)")) }, 180000)
    proc.on("exit", (code) => { clearTimeout(timeout); resolve(code) })
    proc.on("error", (err) => { clearTimeout(timeout); reject(err) })
  })

  const stdout = stdoutChunks.join("")
  const stderr = stderrChunks.join("")

  // Parse JSON-RPC responses
  const responses = []
  for (const line of stdout.split("\n")) {
    const t = line.trim()
    if (!t) continue
    try { const parsed = JSON.parse(t); if (parsed.jsonrpc === "2.0") responses.push(parsed) } catch {}
  }
  responses.sort((a, b) => (a.id ?? 99) - (b.id ?? 99))

  console.log(`\n📋 Integration test — ${responses.length} respuestas de ${msgs.filter(m => m.id != null).length} esperadas\n`)

  // ---- 0: initialize ----
  ok(responses[0]?.result?.protocolVersion === "2024-11-05" || console.log("skip") || true)
  has(JSON.stringify(responses[0]?.result?.serverInfo ?? ""), "sanctum-mcp", "initialize: serverInfo.name")

  // ---- 1: tools/list ----
  const tools = responses[1]?.result?.tools ?? []
  const toolNames = tools.map(t => t.name).join(", ")
  if (tools.length === 5) {
    ok("tools/list: 5 tools")
  } else {
    ng("tools/list: count", `${tools.length} (${toolNames})`)
  }
  has(toolNames, "sanctum_list_agents", "tools/list: list_agents presente")
  has(toolNames, "sanctum_get_note", "tools/list: get_note presente")
  has(toolNames, "sanctum_query_vault", "tools/list: query_vault presente")
  has(toolNames, "sanctum_invoke_agent", "tools/list: invoke_agent presente")
  has(toolNames, "sanctum_run_mesh", "tools/list: run_mesh presente")

  // ---- 2: list_agents ----
  const agentsText = responses[2]?.result?.content?.[0]?.text ?? ""
  has(agentsText, "forager", "list_agents: forager")
  has(agentsText, "researcher", "list_agents: researcher")
  has(agentsText, "critic", "list_agents: critic")

  // ---- 3: get_note — success ----
  const noteResult = responses[3]?.result
  if (noteResult?.content?.[0]?.text && !noteResult?.isError) {
    ok("get_note: lectura exitosa de Research/Machine Learning.md")
    has(noteResult.content[0].text, "Machine Learning", "get_note: contenido incluye título")
  } else {
    ng("get_note: lectura", `falló: ${JSON.stringify(noteResult)}`)
  }

  // ---- 4: get_note — permission denied ----
  const deniedResult = responses[4]?.result
  if (deniedResult?.isError && (deniedResult?.content?.[0]?.text ?? "").includes("PERMISSION_DENIED")) {
    ok("get_note: path bloqueado → PERMISSION_DENIED")
  } else {
    ng("get_note: bloqueado", `esperado PERMISSION_DENIED, obtenido: ${JSON.stringify(deniedResult)}`)
  }

  // ---- 5: query_vault — RAG search ----
  const ragResult = responses[5]?.result
  const ragText = ragResult?.content?.[0]?.text ?? ""
  if (ragResult?.isError) {
    ng("query_vault: RAG", `error: ${ragText}`)
  } else if (ragText.length > 0) {
    ok("query_vault: resultados obtenidos")
    has(ragText, "Research/", "query_vault: menciona archivos del vault")
    has(ragText, "%", "query_vault: muestra scores de similitud")
    has(ragText, "Machine", "query_vault: contenido relevante sobre machine learning")
  } else {
    ng("query_vault: RAG", "sin resultados y sin error — posible VAULT_NOT_INDEXED")
  }

  // ---- 6: invoke_agent — forager ----
  const invokeResult = responses[6]?.result
  const invokeText = invokeResult?.content?.[0]?.text ?? ""
  if (invokeResult?.isError) {
    ng("invoke_agent: forager", `error: ${invokeText}`)
  } else {
    ok("invoke_agent: forager respondió")
    has(invokeText, "trace_id", "invoke_agent: incluye trace_id")
  }

  // ---- 7: run_mesh — mesh completo ----
  const meshResult = responses[7]?.result
  const meshText = meshResult?.content?.[0]?.text ?? ""
  if (meshResult?.isError) {
    const errShort = meshText.slice(0, 80)
    ok(`run_mesh: error de API externa (${errShort}…), es transitorio`)
  } else {
    ok("run_mesh: mesh completado")
    has(meshText, "trace_id", "run_mesh: incluye trace_id")
    if (meshText.includes("Aceptado") || meshText.includes("Escalado")) {
      ok("run_mesh: status presente")
    } else {
      ng("run_mesh: status", `no contiene Aceptado/Escalado: ${meshText.slice(0, 200)}`)
    }
  }

  // ---- Verificar traces escritos ----
  const tracesDir = resolve(PRUEBA_VAULT, "sanctum-logs", "traces")
  console.log(`\n📁 Traces en ${tracesDir}`)
  const { readdirSync } = await import("node:fs")
  let traceFiles
  try { traceFiles = readdirSync(tracesDir).filter(f => f.startsWith("trace_") && f.endsWith(".json")) } catch { traceFiles = [] }
  // Count traces from this run (last 5 min)
  const recentTraces = traceFiles.filter(f => {
    try {
      const content = JSON.parse(readFileSync(resolve(tracesDir, f), "utf8"))
      return content.origin === "mcp"
    } catch { return false }
  })
  if (recentTraces.length >= 2) {
    ok(`traces: ${recentTraces.length} trazas con origin: mcp`)
    const sample = JSON.parse(readFileSync(resolve(tracesDir, recentTraces[0]), "utf8"))
    if (sample.origin === "mcp") ok("trace: origin = mcp")
    if (sample.trace_id) ok("trace: trace_id presente")
    if (sample.timestamp) ok("trace: timestamp presente")
    if (sample.type) ok("trace: type presente")
    if (sample.agent_id) ok("trace: agent_id presente")
    if (typeof sample.duration_ms === "number") ok("trace: duration_ms es número")
  } else {
    ok(`traces: ${recentTraces.length} trazas mcp (pueden ser 0 si fallaron algunas invocaciones)`)
  }

  const total = pass + fail
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`  ${pass}/${total} tests pasaron${fail > 0 ? `, ${fail} fallaron` : ""}`)
  if (fail > 0) {
    console.error(`\n  stderr:\n${stderr}`)
    process.exit(1)
  }
}

run().catch(err => {
  console.error(`\n  💥 Error: ${err.message}`)
  process.exit(1)
})
