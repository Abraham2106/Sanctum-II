# Sanctum II — MCP Server

Servidor MCP que expone el mesh de agentes de Sanctum II como tools estándar para cualquier cliente MCP (VS Code, Opencode, Cline, etc.).

## Requisitos

- Node.js 18+
- Vault de Obsidian en disco (archivos `.md`)
- API keys (según las tools que quieras usar):
  - **Gemini** (`GEMINI_API_KEYS`): para RAG (embeddings) — necesaria para `sanctum_query_vault`
  - **OpenCode** (`OPENCODE_GO_API_KEY`): para invocar agentes LLM — necesaria para `sanctum_invoke_agent` y `sanctum_run_mesh`

## Uso rápido

```bash
# 1. Build
npm run build

# 2. Ejecutar (prueba manual)
SANCTUM_VAULT_PATH=/ruta/al/vault node mcp-server/dist/index.cjs

# 3. Smoke test
node mcp-server/test/smoke.mjs
```

El servidor queda escuchando en **stdin** esperando mensajes JSON-RPC. Enviale una línea con `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}` para probar.

## Variables de entorno

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `SANCTUM_VAULT_PATH` | ✅ (recomendada) | `./notes` | Ruta al directorio raíz del vault de Obsidian |
| `GEMINI_API_KEYS` | Para RAG | — | Keys de Gemini API, separadas por coma (rotación automática) |
| `OPENCODE_GO_API_KEY` | Para LLM | — | API key de OpenCode para invocar `deepseek-v4-flash` |
| `OPENCODE_GO_BASE_URL` | No | `https://api.opencode.ai/v1` | Base URL de la API OpenCode |
| `SANCTUM_LOG_LEVEL` | No | `info` | Nivel de log: `debug`, `info`, `warn`, `error` |
| `SANCTUM_MESH_TIMEOUT_MS` | No | `120000` | Timeout en ms para `sanctum_run_mesh` |

## Tools disponibles (5)

| Tool | Requiere | Descripción |
|---|---|---|
| `sanctum_list_agents` | nada | Lista agentes disponibles (fijos + custom) |
| `sanctum_get_note` | nada | Lee una nota por path, validando `read_paths` del agente |
| `sanctum_query_vault` | Gemini | Búsqueda RAG semántica sobre el vault indexado |
| `sanctum_invoke_agent` | OpenCode | Invoca un agente individual con un prompt |
| `sanctum_run_mesh` | OpenCode | Loop Forager → Researcher → Critic con score |

## Conexión con clientes MCP

### VS Code / Cline

Agregá esta configuración en `.vscode/mcp.json` del proyecto:

```jsonc
{
  "mcpServers": {
    "sanctum-ii": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-server/dist/index.cjs"],
      "env": {
        "SANCTUM_VAULT_PATH": "${workspaceFolder}",
        "GEMINI_API_KEYS": "${env:GEMINI_API_KEYS}",
        "OPENCODE_GO_API_KEY": "${env:OPENCODE_GO_API_KEY}",
        "OPENCODE_GO_BASE_URL": "${env:OPENCODE_GO_BASE_URL}"
      }
    }
  }
}
```

> `${workspaceFolder}` se resuelve automáticamente al proyecto abierto. `${env:VAR}` hereda del entorno del sistema. Asegurate de tener las variables en tus env vars del sistema (o terminal).

**Si querés apuntar al vault de prueba `prueba/`**, cambiá `SANCTUM_VAULT_PATH`:

```json
"env": {
  "SANCTUM_VAULT_PATH": "${workspaceFolder}/../prueba",
  ...
}
```

### Opencode (`opencode.json` en la raíz del proyecto)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sanctum-ii": {
      "type": "local",
      "command": ["node", "mcp-server/dist/index.cjs"],
      "enabled": true,
      "environment": {
        "SANCTUM_VAULT_PATH": ".",
        "GEMINI_API_KEYS": "${GEMINI_API_KEYS}",
        "OPENCODE_GO_API_KEY": "${OPENCODE_GO_API_KEY}",
        "OPENCODE_GO_BASE_URL": "${OPENCODE_GO_BASE_URL}"
      }
    }
  }
}
```

> Los placeholders `${VAR}` heredan automáticamente el valor del entorno del host. No hace falta hardcodear las keys en el JSON.

### Archivo `.env` de referencia

```env
# Obligatorio para RAG
GEMINI_API_KEYS=ai_key_1,ai_key_2,ai_key_3

# Obligatorio para LLM
OPENCODE_GO_API_KEY=sk-opencode-...
OPENCODE_GO_BASE_URL=https://api.opencode.ai/v1

# Opcionales
SANCTUM_LOG_LEVEL=info
SANCTUM_MESH_TIMEOUT_MS=120000
```

## Verificación

```bash
# 1. Build
npm run build

# 2. Smoke test (verifica que el servidor arranca y responde)
node mcp-server/test/smoke.mjs
# → 18/18 tests pasan

# 3. Prueba manual con pipes
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' | node mcp-server/dist/index.cjs
```

## Arquitectura

```
Cliente MCP (VS Code/Opencode)
  └─ node mcp-server/dist/index.cjs
       ├── McpServer (stdio + JSON-RPC dispatch)
       ├── VaultAdapter (node:fs → vault en disco)
       ├── PermissionResolver (read_paths de cada agente)
       ├── Gemini Embed (fetch → gemini-embedding-2)
       ├── OpenCode Chat (fetch → deepseek-v4-flash)
       ├── VectorStore (JSONL + Base64, mismo formato que el plugin)
       ├── TraceWriter (sanctum-logs/traces/ con origin: "mcp")
       └── 5 tool factories (una por tool, DI)
```

## Build

El MCP server se compila como parte del build normal:

```bash
npm run build
# → main.js (plugin Obsidian)
# → mcp-server/dist/index.cjs (MCP server)
```
