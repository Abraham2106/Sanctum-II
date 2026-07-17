# Sanctum-II — MCP Server (Especificación de Implementación)

> **Propósito de este documento:** especificación autocontenida y accionable para construir el servidor MCP de Sanctum-II — el componente que expone el mesh de agentes a clientes externos como VS Code (Copilot/Claude Code) y Opencode.
> **Relación con los otros documentos:** este documento es la bajada a implementación de la sección 13 de `Sanctum-II-Vision.md`. Las decisiones de arquitectura ya están cerradas ahí; acá se detalla cómo construirlas. Cualquier cambio a una decisión ya cerrada debe reflejarse primero en la Visión, no solo acá.
> **Referencia de implementación:** el scaffold `docs-local/dummy-code-mcp/` contiene una implementación funcional de referencia con los mismos patrones (McpServer sobre stdio, VaultAdapter, tool factories, logger a stderr). Este documento refleja esas decisiones ya validadas en código.
> **Última actualización:** 2026-07-12

---

## 1. Qué es esto y qué problema resuelve

Hasta ahora, el mesh de Sanctum-II (Forager → Researcher → Critic, RAG, permisos, orquestador) solo es invocable desde el chat lateral dentro de Obsidian. Este documento especifica un **servidor MCP standalone** que expone ese mismo mesh como un set de tools estándar, para que un desarrollador trabajando en VS Code u Opencode pueda consultar el vault o correr el mesh sin necesidad de tener Obsidian abierto.

No es un sistema nuevo. Es una **fachada delgada** sobre el mismo core (RAG, agentes, orquestador) que ya existe — reutiliza el mismo filtro de permisos, el mismo formato de agente `.md`/`.yaml`, y la misma lógica de evaluación del Critic.

---

## 2. Decisiones de arquitectura

| Decisión | Valor | Fundamento |
|---|---|---|
| **Transporte** | Local únicamente — **stdio**, sin puerto de red | Estándar MCP; cualquier cliente que pueda lanzar un subproceso puede hablar con el servidor |
| **Ubicación del servidor** | **Proceso Node standalone**, no embebido en Obsidian | Permite usar el servidor sin Obsidian abierto; elimina la dependencia del ciclo de vida de Electron |
| **Acceso al vault** | **VaultAdapter** — abstracción de filesystem con interfaz explícita. Implementación primaria: `node:fs` leyendo el vault directo del disco | El mismo core (RAG, agentes, orquestador) puede correr tanto en el plugin de Obsidian (implementando VaultAdapter con `app.vault`) como en el MCP server standalone (implementándolo con `node:fs`) |
| **Ciclo de vida** | El servidor vive mientras el proceso Node está corriendo, independiente de Obsidian | El cliente MCP lanza y mata el proceso; si el vault cambia en disco, el índice debe poder refrescarse |
| **Modelo de permisos** | Cada llamada declara un `agent_id` explícito y hereda exactamente sus `read_paths`/`write_paths` | Idéntico al mecanismo del plugin; el VaultAdapter aplica el filtro, no el caller |
| **Alcance v1** | Solo lectura/invocación — sin escritura al vault, sin streaming de `loop_state`, sin auth adicional | Misma superficie que el spec original; la escritura y streaming se posponen |
| **Modelo de confianza** | Igual que cualquier MCP server local: quien puede lanzar el subproceso, puede usarlo | El vault path se pasa por variable de entorno `SANCTUM_VAULT_PATH` |
| **Protocolo MCP** | **Implementación manual** (sin dependencia del SDK de Anthropic) | ~130 líneas de TypeScript puro con `readline` + `process.stdout.write`; cero deps, 100% inspeccionable. Migrable al SDK si se necesita en el futuro |
| **Logging** | **Todo log a stderr** en JSON estructurado. `stdout` reservado exclusivamente para JSON-RPC | Un solo `console.log()` a stdout corrompe el stream y rompe el cliente MCP. Esta regla es no negociable |

Si alguna de estas filas necesita cambiar, el cambio se documenta primero en `Sanctum-II-Vision.md` sección 13, con el razonamiento de por qué se revierte — no se improvisa acá.

---

## 3. Arquitectura del componente

```
┌──────────────────────────────────────────────────────────┐
│              MCP CLIENT (VS Code / Opencode)               │
│                                                             │
│  Lanza: node sanctum-mcp/dist/index.js                     │
│  env: SANCTUM_VAULT_PATH=/ruta/al/vault                    │
└─────────────────────────┬─────────────────────────────────┘
                          │  JSON-RPC 2.0 sobre stdio
                          │  (stdin → request, stdout → response)
┌─────────────────────────┼─────────────────────────────────┐
│              PROCESO NODE (standalone)                       │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  MCP SERVER                             │  │
│  │  ──────────────────────────────────────────────────   │  │
│  │  1. McpServer (stdio transport + JSON-RPC dispatch)    │  │
│  │  2. Tool Registry (5 tool factories registradas)       │  │
│  │  3. Permission Resolver (mismo mecanismo del plugin)   │  │
│  │  4. Tool Handlers (una factory por tool)               │  │
│  │  5. Logger (stderr, JSON estructurado)                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              VAULT ADAPTER (node:fs)                    │  │
│  │  ──────────────────────────────────────────────────   │  │
│  │  • listMarkdown() → string[]                           │  │
│  │  • readNote(path) → { path, title, content }           │  │
│  │  • Interfaz compartida con el plugin de Obsidian       │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │        VAULT (.md)       │
              │  /ruta/al/vault/         │
              │    ├── Research/         │
              │    ├── Projects/         │
              │    └── ...               │
              └────────────────────────┘
```

### 3.1 Los 5 subcomponentes internos

1. **McpServer** — capa de protocolo: lee JSON-RPC de `stdin` vía `readline`, despacha a tools registradas, escribe respuestas a `stdout`. Implementa el subset esencial de MCP: `initialize`, `ping`, `tools/list`, `tools/call`. No depende de ninguna librería externa. Referencia: `dummy-code-mcp/src/mcp/server.ts`.

2. **Tool Registry** — no es una clase separada, es el `Map<string, ToolDef>` interno del McpServer. Las tools se registran con `server.registerTool(tool)`. Cada tool se crea vía una **factory function** que recibe sus dependencias por inyección (VaultAdapter, VectorStore, OpenCodeClient, etc.). Esto permite testear cada tool aislada y reusar el mismo código en el plugin y en el servidor standalone.

3. **Permission Resolver** — dado un `agent_id`, busca su definición `.md`/`.yaml` (via VaultAdapter, misma ruta `sanctum-agents/`) y devuelve sus `read_paths`/`write_paths`. Es el mismo mecanismo que usa el plugin (`src/agents/agent-loader.ts`), adaptado para recibir un VaultAdapter en vez de `obsidian.Vault`.

4. **Tool Handlers** — una factory function por cada una de las 5 tools (sección 5). Cada factory recibe las dependencias que necesita (VaultAdapter para `get_note`, VectorStore para `query_vault`, Agent Runtime para `invoke_agent`, Orquestador para `run_mesh`) y devuelve un `ToolDef` con su `inputSchema` y `handler`. Referencia: `dummy-code-mcp/src/tools/notes-search.ts` y `review-content.ts`.

5. **Logger** — escribe logs estructurados (JSON, una línea por entrada) exclusivamente a `stderr`. `stdout` está reservado para el protocolo JSON-RPC y no debe ser contaminado bajo ninguna circunstancia. Nivel de log configurable vía `SANCTUM_LOG_LEVEL` (debug, info, warn, error; default: info). Referencia: `dummy-code-mcp/src/mcp/logger.ts`.

### 3.2 VaultAdapter — la abstracción que unifica plugin y servidor

El VaultAdapter es una **interfaz TypeScript** que abstrae el acceso al filesystem del vault. El core de Sanctum (RAG, agentes, orquestador) debe depender de esta interfaz, no de la API de Obsidian directamente.

```typescript
interface VaultAdapter {
  listMarkdown(): Promise<string[]>
  readNote(path: string): Promise<{ path: string; title: string; content: string }>
}
```

**Dos implementaciones previstas:**

| Implementación | Dónde corre | Tecnología |
|---|---|---|
| `FsVaultAdapter` | MCP Server standalone | `node:fs` — lectura directa del disco |
| `ObsidianVaultAdapter` | Plugin de Obsidian | `app.vault.adapter` — API nativa de Obsidian |

Esto permite que exactamente el mismo código de `executeTurn()`, `runMeshWithCritic()`, `loadAgentFromVault()`, y `VectorStore.load()/save()` corra en ambos entornos sin cambios.

**Refactor necesario:** modificar las firmas internas del core para recibir un `VaultAdapter` donde actualmente reciben `obsidian.Vault` o `vault.adapter` directamente. El plugin inyecta su `ObsidianVaultAdapter` en `onload()`, el MCP server inyecta `FsVaultAdapter` en `index.ts`.

---

## 4. Cómo se inicia el servidor

El servidor **no requiere Obsidian abierto**. Es un proceso Node standalone lanzado directamente por el cliente MCP:

```
MCP Client (VS Code / Opencode)
  └─ Lee mcp.json:
       {
         "mcpServers": {
           "sanctum-ii": {
             "command": "node",
             "args": ["./mcp-server/dist/index.js"],
             "env": {
               "SANCTUM_VAULT_PATH": "/ruta/al/vault"
             }
           }
         }
       }
  └─ Lanza: node ./mcp-server/dist/index.js
       └─ Lee SANCTUM_VAULT_PATH del env
       └─ Instancia FsVaultAdapter(vaultPath)
       └─ Carga agentes desde sanctum-agents/ (vía VaultAdapter)
       └─ Inicializa VectorStore, OpenCodeClient, GeminiBalancer
       └─ Crea y registra las 5 tool factories
       └─ McpServer.start() → queda escuchando en stdin
       └─ Log: "Sanctum MCP listo (stdio)" a stderr
```

El cliente MCP maneja el ciclo de vida del proceso: lo lanza al necesitarlo, lo mantiene corriendo mientras lo usa, y lo mata al cerrar. Si el proceso muere, el cliente puede relanzarlo — el servidor es stateless entre invocaciones.

### 4.1 Configuración del lado del cliente (mcp.json)

**VS Code / Claude Code:**
```json
{
  "mcpServers": {
    "sanctum-ii": {
      "command": "node",
      "args": ["/ruta/a/sanctum-ii/mcp-server/dist/index.js"],
      "env": {
        "SANCTUM_VAULT_PATH": "/ruta/al/vault",
        "SANCTUM_LOG_LEVEL": "info",
        "OPENCODE_GO_API_KEY": "...",
        "OPENCODE_GO_BASE_URL": "...",
        "GEMINI_API_KEYS": "..."
      }
    }
  }
}
```

**Opencode (`opencode.json`):**
```json
{
  "mcpServers": {
    "sanctum-ii": {
      "command": "node",
      "args": ["/ruta/a/sanctum-ii/mcp-server/dist/index.js"],
      "env": {
        "SANCTUM_VAULT_PATH": "/ruta/al/vault"
      }
    }
  }
}
```

Las variables de API key pueden venir del entorno del host en vez de hardcodearse en el JSON de configuración.

---

## 5. Especificación de las 5 tools

Todas las tools siguen JSON Schema estándar de MCP. Se listan en orden de dependencia (las que no requieren agente primero).

Cada tool se implementa como una **factory function**:

```typescript
function createListAgentsTool(vault: VaultAdapter): ToolDef {
  return {
    name: "sanctum_list_agents",
    description: "...",
    inputSchema: { type: "object", properties: { ... } },
    handler: async (args) => { ... }
  }
}
```

El `index.ts` del servidor instancia las factories con sus dependencias y las registra:

```typescript
const vault = new FsVaultAdapter(vaultRoot)
server.registerTool(createListAgentsTool(vault))
server.registerTool(createQueryVaultTool(vault, vectorStore, geminiBalancer))
server.registerTool(createGetNoteTool(vault))
server.registerTool(createInvokeAgentTool(vault, vectorStore, opencodeClient, geminiBalancer))
server.registerTool(createRunMeshTool(vault, vectorStore, opencodeClient, geminiBalancer))
```

### 5.1 `sanctum_list_agents`

Única tool sin filtro de permisos — solo expone metadata, nunca contenido del vault.

**Input:**
```json
{}
```

**Output:**
```json
{
  "agents": [
    {
      "id": "forager",
      "name": "Forager",
      "avatar": "🔍",
      "description": "Investigador que reformula prompts y reúne contexto",
      "fixed": true
    },
    {
      "id": "researcher",
      "name": "Researcher",
      "description": "Ejecuta la investigación combinando vault y web search",
      "fixed": true
    },
    {
      "id": "critic",
      "name": "Critic",
      "description": "Evalúa el output con score anclado y decide aceptar/regenerar",
      "fixed": true
    },
    {
      "id": "fact_checker",
      "name": "Fact Checker",
      "description": "Agente custom del usuario para verificar afirmaciones",
      "fixed": false
    }
  ]
}
```

**Implementación:** lee `sanctum-agents/` vía VaultAdapter, parsea los frontmatter YAML de cada `.md`, mapea a `{id, name, avatar, description, fixed}`. No toca RAG ni permisos.

### 5.2 `sanctum_query_vault`

RAG query cruda, sujeta a permisos del agente declarado.

**Input:**
```json
{
  "agent_id": "forager",
  "query": "impacto de X en Y",
  "max_results": 5
}
```

**Output:**
```json
{
  "chunks": [
    {
      "content": "...",
      "from_note": "Research/nota-A.md",
      "similarity_score": 0.84
    }
  ],
  "filtered_by": "forager.read_paths: [\"/Research/**\"]"
}
```

**Implementación:**
1. Permission Resolver busca `agent_id` en `sanctum-agents/` → si no existe, error `AGENT_NOT_FOUND`.
2. Ejecuta la query contra el vector store local con cosine similarity (mismo `VectorStore.search()` del plugin).
3. Filtra resultados por `read_paths` del agente vía `globMatch()` — **el filtro se aplica en el momento de la consulta**, igual que en el plugin, no en el momento de indexar.
4. Devuelve chunks + de dónde vienen + un campo `filtered_by` para trazabilidad.

### 5.3 `sanctum_get_note`

Lectura directa de una nota por path, sujeta a permisos.

**Input:**
```json
{
  "agent_id": "forager",
  "path": "Research/nota-A.md"
}
```

**Output (éxito):**
```json
{
  "content": "# Nota A\n...",
  "path": "Research/nota-A.md"
}
```

**Output (bloqueado por permisos):**
```json
{
  "error": "PERMISSION_DENIED",
  "message": "El agente 'forager' no tiene read_paths que cubran 'Finanzas/reporte.md'"
}
```

**Implementación:** Permission Resolver valida que `path` caiga dentro de algún patrón de `read_paths` del agente **antes** de tocar el filesystem vía VaultAdapter. Si no matchea, devuelve error sin leer el archivo (fail closed, no fail open).

### 5.4 `sanctum_invoke_agent`

Invoca un agente puntual (no el mesh completo) con un prompt.

**Input:**
```json
{
  "agent_id": "forager",
  "prompt": "Reformulá esto: investigá el impacto de X en Y"
}
```

**Output:**
```json
{
  "agent_id": "forager",
  "output": "...",
  "trace_id": "trace_2026-07-12_10-15-02_c4f1"
}
```

**Implementación:**
1. Permission Resolver resuelve `read_paths`/`write_paths` de `agent_id`.
2. Si el agente tiene `tools: [rag_query, ...]` en su definición, esas tools se ejecutan ya filtradas por sus propios permisos (comportamiento normal del Agent Runtime).
3. Se arma el system prompt real del agente (frontmatter + cuerpo) y se invoca el modelo vía `OpenCodeClient.chat()`.
4. Se escribe un trace en `/sanctum-logs/` con el mismo formato del plugin, agregando `origin: "mcp"` para distinguir invocaciones externas.
5. Se devuelve el output crudo del agente + el `trace_id`.

### 5.5 `sanctum_run_mesh`

Dispara el loop completo Forager → Researcher → Critic.

**Input:**
```json
{
  "prompt": "Investigá el impacto de X en Y",
  "threshold": 80
}
```

> Nota: a diferencia de las otras tools, `sanctum_run_mesh` no toma un único `agent_id` — internamente usa el trío fijo `forager`/`researcher`/`critic`, cada uno con sus propios `read_paths` ya definidos en su YAML. `threshold` es opcional; si se omite, usa el default del sistema (80).

**Output (aceptado):**
```json
{
  "status": "accepted",
  "output": "...",
  "final_score": 85,
  "attempts": 2,
  "trace_id": "trace_2026-07-12_10-20-11_a9b2"
}
```

**Output (escalado):**
```json
{
  "status": "escalated",
  "best_attempt": "...",
  "rejection_reason": [
    "Resolver la contradicción entre sección 2 y 4",
    "Buscar al menos 2 fuentes de 2025-2026"
  ],
  "final_score": 68,
  "attempts": 3,
  "trace_id": "trace_2026-07-12_10-22-40_e1d7"
}
```

**Implementación:**
1. Delega enteramente en `runMeshWithCritic()` de `src/orchestrator/mesh.ts` — el servidor MCP no reimplementa la lógica de reintentos, threshold, ni `loop_state`. Simplemente invoca al orquestador con el prompt inicial y espera el resultado final.
2. El orquestador corre su ciclo normal: `forager` → `researcher` → `critic`, hasta `ACCEPT` o `ESCALATE_TO_USER` (máx. 3 intentos).
3. Si el estado final es `ESCALATE_TO_USER`, el servidor MCP lo traduce a `status: "escalated"` y devuelve el mejor intento + motivo de rechazo — el cliente externo decide qué hacer con eso.
4. Como esta tool no toma `agent_id` en el input, **no hay nada que resolver en el Permission Resolver a nivel de la tool misma** — los permisos ya están fijados en el YAML de cada uno de los tres agentes fijos.

---

## 6. Manejo de errores

### 6.1 Errores de protocolo vs. errores de tool

Hay dos niveles de error, con comportamiento distinto:

| Nivel | Cómo se devuelve | Ejemplo |
|---|---|---|
| **Error de protocolo** (tool no encontrada, parámetro inválido, método desconocido) | JSON-RPC error object: `{ code, message }` en el sobre de la respuesta | `tools/call` con `name: "tool_inexistente"` → `{ error: { code: -32602, message: "Tool desconocida: ..." } }` |
| **Error de tool** (la tool se ejecutó pero falló en su lógica de dominio) | Resultado normal con `isError: true` en el content | `sanctum_get_note` con path sin permisos → `{ content: [{ type: "text", text: "Error: PERMISSION_DENIED ..." }], isError: true }` |

Esta distinción es importante: los errores de protocolo los maneja el propio McpServer automáticamente; los errores de dominio los maneja cada handler atrapando excepciones y devolviendo `isError: true`. El cliente MCP usa `isError` para decidir si mostrar el resultado como error al usuario.

### 6.2 Códigos de error de dominio

Todas las tools devuelven errores de dominio en un formato consistente dentro del content:

```json
{
  "content": [{ "type": "text", "text": "Error: CODE - Descripción legible" }],
  "isError": true
}
```

| Código | Cuándo ocurre |
|---|---|
| `AGENT_NOT_FOUND` | El `agent_id` no existe entre los agentes fijos ni custom |
| `PERMISSION_DENIED` | El path solicitado cae fuera de los `read_paths` del agente |
| `VAULT_NOT_INDEXED` | Se llama a `sanctum_query_vault` antes de que el índice inicial termine |
| `MESH_TIMEOUT` | `sanctum_run_mesh` supera un timeout configurable sin llegar a `ACCEPT` ni `ESCALATE_TO_USER` |
| `VAULT_NOT_FOUND` | `SANCTUM_VAULT_PATH` no apunta a un directorio válido o no contiene archivos `.md` |

### 6.3 Regla de stdout/stderr

**Crítico:** `stdout` está reservado exclusivamente para los mensajes JSON-RPC del protocolo MCP. Un solo `console.log()` a stdout corrompe el stream y rompe la comunicación con el cliente (VS Code, Opencode). Todo log, trace, y debug debe escribirse a `stderr`.

El logger del servidor (`src/mcp/logger.ts`) implementa esta regla:

```typescript
process.stderr.write(JSON.stringify({ ts, level, msg }) + "\n")
```

---

## 7. Observabilidad

### 7.1 Logger del servidor (stderr)

El servidor escribe logs estructurados a `stderr` en formato JSON (una línea por entrada):

```json
{"ts":"2026-07-12T10:20:11.000Z","level":"info","msg":"Sanctum MCP listo (stdio)","meta":{"tools":["sanctum_list_agents","sanctum_query_vault","sanctum_get_note","sanctum_invoke_agent","sanctum_run_mesh"]}}
{"ts":"2026-07-12T10:20:15.000Z","level":"info","msg":"tool call","meta":{"name":"sanctum_query_vault"}}
```

Nivel de log configurable vía variable de entorno `SANCTUM_LOG_LEVEL` (debug, info, warn, error; default: info).

### 7.2 Traces de ejecución (mismo formato del plugin)

Cada tool que ejecuta un agente o el mesh escribe un trace con el **mismo shape** definido para el plugin, con campos adicionales:

```yaml
trace_id: "trace_2026-07-12_10-20-11_a9b2"
timestamp: "2026-07-12T10:20:11Z"
type: "agent_invocation"        # o "mesh_run", "rag_query", "note_read"
origin: "mcp"                    # distingue de "obsidian_chat"
mcp_client: "vscode"              # identificado en el handshake initialize, si está disponible
agent_id: "forager"
input:
  system_prompt: "..."
  user_prompt: "..."
  injected_context: [...]
output: "..."
duration_ms: 2340
```

Los traces se guardan en `sanctum-logs/traces/` dentro del vault (misma ruta que usa el plugin). Si el vault está en un volumen de red o el path es relativo, el VaultAdapter resuelve la escritura.

Con esto se pueden responder, además de las preguntas de depuración del plugin, una adicional: **¿esta ejecución vino de Obsidian o de un cliente MCP externo, y cuál?**

---

## 8. Explícitamente fuera de alcance en esta v1

No implementar nada de esto sin volver primero a discutirlo en `Sanctum-II-Vision.md`:

- **Escritura al vault desde MCP.** El campo `write_paths` existe en el schema de agente pero la resolución de conflictos de escritura sigue siendo un frente abierto. Ninguna tool de este documento escribe.
- **Streaming del `loop_state`.** `sanctum_run_mesh` devuelve solo el resultado final, no actualizaciones incrementales por paso.
- **Resolución de `ESCALATE_TO_USER` vía MCP.** Cuando el mesh escala, el cliente externo recibe la info pero no hay una tool para "aceptar igual" o "ajustar threshold y reintentar" — eso es un flujo pensado para la UI de Obsidian.
- **Autenticación/autorización entre procesos.** Al ser stdio local, no hay tokens. El modelo de confianza es el del sistema operativo: quien puede lanzar el subproceso, puede usarlo.
- **Multi-vault.** Se asume un solo vault activo por instancia del servidor, especificado vía `SANCTUM_VAULT_PATH`.
- **Indexación automática por cambios en disco.** El servidor no watchea el filesystem. Si el vault cambia mientras el servidor corre (porque Obsidian está abierto en paralelo), el índice puede desincronizarse. La reindexación es un comando manual por ahora.

---

## 9. Frentes abiertos

Estos puntos no tienen decisión cerrada todavía y deben resolverse antes o durante la implementación:

1. **Timeout configurable de `sanctum_run_mesh`** (código `MESH_TIMEOUT`, sección 6.2) — falta decidir el valor default y si es configurable por el usuario o fijo. Sugerencia inicial: 120 segundos, configurable vía `SANCTUM_MESH_TIMEOUT_MS`.

### 9.1 Frentes cerrados (resueltos por el dummy-code-mcp)

| # | Frente original | Resolución |
|---|---|---|
| 1 | Mecanismo de arranque del proceso MCP | **Standalone**: proceso Node lanzado por el cliente MCP, sin dependencia de Obsidian. Resuelto por el patrón del `dummy-code-mcp/src/index.ts`. |
| 2 | Qué pasa si Obsidian se cierra durante una llamada | **No aplica**: el servidor es independiente de Obsidian. Si el proceso Node muere, el cliente MCP recibe EOF en stdin y puede relanzarlo. |
| 3 | Versión del protocolo MCP y librería a usar | **Implementación manual**: protocol version `2024-11-05`, sin SDK externo. ~130 líneas de TypeScript puro (`readline` + `process.stdout.write`). Migrable al SDK de Anthropic si se necesita en el futuro sin cambiar la interfaz de tools. Resuelto por `dummy-code-mcp/src/mcp/server.ts`. |

---

## 10. Orden de construcción

Sigue la misma filosofía del MVP general: superficie mínima primero, sin mesh completo hasta validar el contrato base. Las tools que requieren RAG, LLM o mesh asumen que el core ya fue refactorizado para depender de `VaultAdapter` en vez de la API de Obsidian (ver sección 3.2).

### Paso 0 — Refactor VaultAdapter en el core

Antes de construir el MCP server, refactorizar el core del plugin para que dependa de la interfaz `VaultAdapter`:

```
src/core/vault-adapter.ts    ← interfaz TypeScript
  ├── listMarkdown(): Promise<string[]>
  └── readNote(path): Promise<{ path, title, content }>

Plugin:  src/core/obsidian-vault-adapter.ts  ← implementa VaultAdapter con app.vault
MCP:     mcp-server/src/core/fs-vault-adapter.ts  ← implementa VaultAdapter con node:fs
```

Archivos del core que deben adaptarse: `agent-loader.ts`, `indexer.ts`, `vector-store.ts` (load/save), `note-writer.ts`, `mesh.ts`, `agent-turn.ts`.

### Paso 1 — McpServer + `sanctum_list_agents`

- Crear `mcp-server/` como entry point separado en `esbuild.config.mjs`
- Implementar `McpServer` (stdio transport + JSON-RPC dispatch, ~130 líneas)
- Implementar `Logger` (stderr, JSON estructurado)
- Implementar `FsVaultAdapter`
- Implementar `sanctum_list_agents` (lee `sanctum-agents/` vía VaultAdapter, devuelve metadata)
- **Validación:** smoke test que lanza el proceso, hace `initialize` → `tools/list` → `tools/call sanctum_list_agents`. Sin RAG, sin permisos.
- **Referencia:** `dummy-code-mcp/` completo — es funcional para este paso.

### Paso 2 — Permission Resolver + `sanctum_get_note`

- Implementar `PermissionResolver` que lee agentes del vault y expone `resolvePermissions(agentId)`
- Implementar `sanctum_get_note` con validación de `read_paths` antes de leer
- Manejar `AGENT_NOT_FOUND` y `PERMISSION_DENIED`
- **Validación:** smoke test con agente que no tiene acceso a cierta ruta → error controlado.

### Paso 3 — `sanctum_query_vault`

- Conectar con `VectorStore` y `GeminiBalancer` existentes (ambos ya refactorizados a VaultAdapter)
- Implementar `sanctum_query_vault` con embedding de la query + cosine similarity + filtro de permisos
- Manejar `VAULT_NOT_INDEXED`, `MIN_SIMILARITY = 0.65`
- **Validación:** smoke test con vault indexado → recibe chunks relevantes y filtrados.

### Paso 4 — `sanctum_invoke_agent`

- Conectar con `OpenCodeClient` y `executeTurn()` existentes
- Implementar `sanctum_invoke_agent`: carga el agente, resuelve permisos, ejecuta turn, devuelve output + trace_id
- **Validación:** smoke test con `agent_id: "forager"` y un prompt → respuesta del LLM con contexto del vault.

### Paso 5 — `sanctum_run_mesh`

- Conectar con `runMeshWithCritic()` existente
- Implementar `sanctum_run_mesh`: dispara el loop completo, traduce `LoopState` final a resultado MCP
- Implementar timeout (`MESH_TIMEOUT` con `SANCTUM_MESH_TIMEOUT_MS`)
- **Validación:** smoke test con prompt de investigación → recibe resultado con score, attempts, y trace_id.

### Paso 6 — Observabilidad con `origin: "mcp"` + smoke test integral

- Extender `Tracer` para aceptar `origin: "mcp"` y `mcp_client`
- Implementar smoke test integral que ejercite las 5 tools en secuencia
- **Validación:** correr el smoke test → verificar traces en `sanctum-logs/traces/` con `origin: "mcp"`.

---

*Este documento es la especificación de implementación de la sección 13 de `Sanctum-II-Vision.md`. Incorpora los patrones validados en `docs-local/dummy-code-mcp/` (McpServer manual sobre stdio, VaultAdapter como abstracción de filesystem, tool factories con inyección de dependencias, logger a stderr). Los frentes abiertos de la sección 9 deben resolverse con el mismo proceso explícito usado para el resto del proyecto, no con defaults asumidos durante la codificación.*

## Actualización 2026-07-16 — Estado implementado

Esta actualización prevalece sobre las referencias históricas a cinco tools y a reindexación exclusivamente manual:

- El servidor expone seis tools; se añadió `sanctum_validate_qubo` para comprobar convenciones QUBO/Ising, signos, normalización y estructura contra contexto autorizado.
- `sanctum_query_vault`, `sanctum_validate_qubo` y `sanctum_invoke_agent` aceptan `project_id` opcional.
- La precedencia de selección es argumento → `SANCTUM_PROJECT_ID` → VectorStore global legacy.
- Los índices de proyecto viven en `sanctum-logs/index/{projectId}/` y se reconcilian antes de una consulta RAG usando `IndexManifestV2` y fingerprints SHA-256.
- La reconciliación respeta los `read_paths` del proyecto; el resultado de RAG se vuelve a filtrar por los `read_paths` del agente. Un permiso vacío continúa siendo denegación.
- El runtime no observa el filesystem continuamente, pero la reconciliación previa hace visibles los cambios en disco sin un comando manual. Obsidian sí usa eventos coalescidos para actualización inmediata.
- `stdout` continúa reservado exclusivamente para JSON-RPC 2.0 y todos los logs se escriben en `stderr`.

El contrato de objetivos y aceptación relacionado se encuentra en [`objetivos-y-casos-de-uso.md`](objetivos-y-casos-de-uso.md).
