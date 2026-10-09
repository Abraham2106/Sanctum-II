# Sanctum II — MCP Server

Servidor MCP que expone el mesh de agentes de Sanctum II como tools estándar para cualquier cliente MCP (VS Code, OpenCode, Cline, etc.).

## Requisitos

- Node.js 22+ (18+ mínimo)
- Vault de Obsidian en disco (archivos `.md`)
- API keys según las tools que uses:
  - **Gemini** (`GEMINI_API_KEYS`): embeddings por defecto para `sanctum_query_vault`
  - **OpenCode** (`OPENCODE_GO_API_KEY`): `sanctum_invoke_agent` y `sanctum_run_mesh`
- **Proyecto** para consultas y notas: `project_id` en la tool o `SANCTUM_PROJECT_ID`

Embeddings locales (`sentence-transformers`) son **opcionales**, manuales y **no** fallback de Gemini. Ver DEC-0023 y `local-embeddings/README.md`. CI no instala PyTorch ni descarga pesos.

> Inferencia en producción y calibración de calidad (umbrales, latencia, VRAM) siguen **pendientes**; las pruebas automatizadas son de contrato con fixtures sintéticos.

## Uso rápido

```bash
# 1. Build
npm run build

# 2. Stdio (prueba manual)
SANCTUM_VAULT_PATH=/ruta/al/vault node mcp-server/dist/index.cjs

# 3. HTTP loopback (launcher portable Windows/Linux)
npm run mcp:http

# 4. Smoke test (vault temporal sintético, sin API keys)
node mcp-server/test/smoke.mjs
```

El servidor stdio escucha JSON-RPC en **stdin**; logs en **stderr**.

## Variables de entorno

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `SANCTUM_VAULT_PATH` | ✅ (recomendada) | `./notes` | Raíz del vault |
| `SANCTUM_PROJECT_ID` | Para query/notas | — | Proyecto por defecto si la tool no envía `project_id` |
| `GEMINI_API_KEYS` | Para RAG Gemini | — | Keys separadas por coma |
| `SANCTUM_EMBED_BACKEND` | No | `gemini` | `gemini` o `sentence-transformers` (local manual) |
| `SANCTUM_LOCAL_EMBED_PORT` | Local | `8767` | Puerto loopback del sidecar Python |
| `SANCTUM_LOCAL_EMBED_TOKEN` | Local | — | Bearer del servicio local |
| `SANCTUM_LOCAL_EMBED_REVISION` | Local | — | Revisión inmutable (40 hex) del modelo |
| `SANCTUM_LOCAL_EMBED_DIMS` | Local | `768` | Dimensiones del vector local |
| `SANCTUM_LOCAL_EMBED_DEVICE` | Local | `cpu` | `cpu` o `cuda` |
| `SANCTUM_LOCAL_EMBED_DTYPE` | Local | `float32` | `float32` o `bfloat16` |
| `OPENCODE_GO_API_KEY` | Para LLM | — | OpenCode / compatible |
| `OPENCODE_GO_BASE_URL` | No | `https://api.opencode.ai/v1` | Base URL chat |
| `SANCTUM_MCP_HTTP` | HTTP | — | `1` para transporte HTTP (usa `npm run mcp:http`) |
| `SANCTUM_MCP_PORT` | HTTP | `8787` | Puerto TCP loopback |
| `SANCTUM_MCP_TOKEN` | HTTP | — | Bearer obligatorio (DEC-0022) |
| `SANCTUM_MCP_ORIGINS` | HTTP web | — | Allowlist exacta de `Origin`, separada por comas |
| `SANCTUM_LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `SANCTUM_MESH_TIMEOUT_MS` | No | `120000` | Timeout de `sanctum_run_mesh` |

## Tools disponibles (6)

| Tool | Requiere | Descripción |
|---|---|---|
| `sanctum_list_agents` | nada | Agentes fijos + custom |
| `sanctum_list_notes` | proyecto | Lista rutas Markdown autorizadas |
| `sanctum_get_note` | proyecto + agente | Lee nota con permisos proyecto ∩ agente |
| `sanctum_query_vault` | proyecto + embedder | RAG sobre generación **publicada** (`ready`); refresco por llamada |
| `sanctum_invoke_agent` | OpenCode | Agente individual; solo el `context` que envíes |
| `sanctum_run_mesh` | OpenCode | Mesh Forager → Researcher ↔ Critic (núcleo `src/runtime/mesh.ts`) |

### Índice por generaciones

Ruta: `sanctum-logs/index/<projectId>/generations/<generationId>/`.

| Estado | Significado |
|---|---|
| `ready` | Generación completa y sellada; MCP puede consultarla |
| `rebuild_required` | Layout legacy o fingerprint/modelo distinto |
| `unavailable` | Sin generación válida |
| `corrupt` | Artefactos incompletos o commit inválido |

Resolución de proyecto: `project_id` → `SANCTUM_PROJECT_ID` → error `PROJECT_REQUIRED`. No hay índice global compartido con el plugin.

## Conexión con clientes MCP

### VS Code / Cline

```jsonc
{
  "mcpServers": {
    "sanctum-ii": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-server/dist/index.cjs"],
      "env": {
        "SANCTUM_VAULT_PATH": "${workspaceFolder}",
        "SANCTUM_PROJECT_ID": "mi-proyecto",
        "GEMINI_API_KEYS": "${env:GEMINI_API_KEYS}",
        "OPENCODE_GO_API_KEY": "${env:OPENCODE_GO_API_KEY}",
        "OPENCODE_GO_BASE_URL": "${env:OPENCODE_GO_BASE_URL}"
      }
    }
  }
}
```

### OpenCode (`opencode.json`)

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
        "SANCTUM_PROJECT_ID": "mi-proyecto",
        "GEMINI_API_KEYS": "${GEMINI_API_KEYS}",
        "OPENCODE_GO_API_KEY": "${OPENCODE_GO_API_KEY}",
        "OPENCODE_GO_BASE_URL": "${OPENCODE_GO_BASE_URL}"
      }
    }
  }
}
```

## Verificación

```bash
npm run verify
# typecheck + vitest + KG + orquestación + Python (si hay) + build + smoke fixture
```

Smoke aislado:

```bash
npm run build && npm run mcp:smoke
```

## Arquitectura (DEC-0022)

```
Cliente MCP (stdio o HTTP loopback)
  └─ mcp-server/dist/index.cjs
       ├── McpServer + tools (6)
       ├── FsVaultAdapter
       ├── ProjectReader + generaciones (index-generations)
       ├── EmbedderPort (Gemini | local opcional vía embedding.ts)
       ├── OpenCode chat
       ├── runMeshCore (src/runtime/mesh.ts)
       └── TraceWriter (sanctum-logs/traces/, origin: mcp)
```

Validación Obsidian Desktop del plugin **no** está cubierta por este smoke; usar el vault real solo con credenciales locales.

## Build

```bash
npm run build
# → main.js (plugin)
# → mcp-server/dist/index.cjs (MCP)
```
