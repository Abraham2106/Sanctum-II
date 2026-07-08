# Registro de Arquitectura — Sanctum II MVP

> Bitácora cronológica de cambios, decisiones técnicas y evolución del diagrama de arquitectura.

---

## 2026-07-08 — Estado inicial (solo docs)

### Cambios
Ninguno. Proyecto con solo documentos de diseño (`README.md`, `docs/MVP.md`, `docs/Vision.md`).

### Justificación
— (fase de diseño puro)

### Diagrama
```
┌─────────────────────────────────────────────┐
│             DOCS / DISEÑO                     │
│  README.md  │  docs/MVP.md  │  docs/Vision.md │
└─────────────────────────────────────────────┘
         ↓
     (sin código)
```

---

## 2026-07-08 — Etapa 0: Setup del plugin Obsidian

### Cambios
- `manifest.json`, `package.json`, `tsconfig.json`, `esbuild.config.mjs`
- `src/main.ts` — plugin con settings panel y vista de chat básica
- `styles.css` — estilos mínimos del chat
- `.env.example` — template de variables de entorno
- Script `deploy.ps1` + npm script `deploy` para build + copia al vault de prueba
- Instalado en vault de prueba `prueba/`

### Justificación
Todo plugin de Obsidian necesita este esqueleto mínimo para cargar en la app. El settings panel permite al usuario configurar sus 3 variables (`OPENCODE_GO_API_KEY`, `OPENCODE_GO_BASE_URL`, `GEMINI_API_KEYS`) sin tocar archivos.

### Diagrama
```
┌──────────────────────────────────────────────────┐
│                  OBSIDIAN                         │
│  ┌──────────────────────────────────────────────┐│
│  │   Sanctum II (plugin)                        ││
│  │   ├── manifest.json                          ││
│  │   ├── main.ts (settings + chat view)         ││
│  │   ├── styles.css                             ││
│  │   └── src/                                   ││
│  │       ├── core/env-loader.ts                 ││
│  │       ├── embeddings/   (vacío)              ││
│  │       ├── rag/          (vacío)              ││
│  │       ├── orchestrator/ (vacío)              ││
│  │       └── observability/ (vacío)             ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

---

## 2026-07-08 — Etapa 1: Gemini proxy-balancer

### Cambios
- `src/embeddings/gemini-balancer.ts` — clase `GeminiBalancer`
- Comando de prueba: "Sanctum II: Probar embeddings"

### Decisión técnica
- **Vector store:** sqlite-vec (elegido sobre sqlite-vss por ser más ligero)
- **Embeddings:** Gemini API con rotación de keys
- **Modelos:** `gemini-embedding-2` (prioridad) → `gemini-embedding-001` (fallback)
- **Rotación:** Si una key falla por quota (429/403), pasa a la siguiente; si se agotan todas, error
- **outputDimensionality:** 768 (balance rendimiento/precisión)

### Errores corregidos
- **Model name bug:** Originalmente usé `gemini-embedding-exp-003-01` y `text-embedding-004` (inexistentes). Corregido a `gemini-embedding-2` y `gemini-embedding-001` tras consultar la documentación oficial.

### Diagrama
```
┌──────────────────────────────────────────────────┐
│                  OBSIDIAN                         │
│  ┌──────────────────────────────────────────────┐│
│  │   Sanctum II                                 ││
│  │                                              ││
│  │   GeminiBalancer ──────► Gemini API          ││
│  │     ├─ 3 keys rotativas      ├─ gemini-      ││
│  │     ├─ fallback modelo       │   embedding-2  ││
│  │     └─ outputDimensionality  └─ gemini-      ││
│  │                               embedding-001  ││
│  │                                              ││
│  │   env-loader.ts ◄──── .env / settings        ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

### Test
```
✅ gemini-embedding-2 (key 1) → 768 dimensiones (200)
✅ gemini-embedding-2 (key 2) → 768 dimensiones (200)
✅ gemini-embedding-2 (key 3) → 768 dimensiones (200)
✅ gemini-embedding-001 (key 1) → 768 dimensiones (200)
✅ gemini-embedding-001 (key 2) → 768 dimensiones (200)
✅ gemini-embedding-001 (key 3) → 768 dimensiones (200)
```

---

## 2026-07-08 — Etapa 2: Conector OpenCode (chat)

### Cambios
- `src/llm/opencode-client.ts` — clase `OpenCodeClient` para chat con `deepseek-v4-flash`
- Integración en `src/main.ts`: comando de prueba + orquestador mínimo
- El orquestador une: prompt → RAG (pendiente) → OpenCode chat → respuesta

### Decisión técnica
- **Cliente:** OpenAI-compatible, usa `{base_url}/chat/completions`
- **Modelo:** `deepseek-v4-flash` (vía OpenCode)
- **Separación de responsabilidades:** GeminiBalancer solo embeddings, OpenCodeClient solo chat. Cada uno con su propia API key y base URL desde el env.

### Diagrama
```
┌──────────────────────────────────────────────────────────────┐
│                      OBSIDIAN                                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │   Sanctum II                                            ││
│  │                                                          ││
│  │   ┌──────────────┐    ┌──────────────────┐              ││
│  │   │ GeminiBalancer│    │ OpenCodeClient    │              ││
│  │   │ (embeddings)  │    │ (chat)            │              ││
│  │   │ → Gemini API  │    │ → OpenCode API    │              ││
│  │   │ gemini-       │    │ deepseek-v4-flash │              ││
│  │   │   embedding-2 │    └────────┬─────────┘              ││
│  │   └──────┬───────┘              │                         ││
│  │          │                      │                         ││
│  │          ▼                      ▼                         ││
│  │   ┌────────────────────────────────────┐                  ││
│  │   │      Orquestador mínimo            │                  ││
│  │   │  prompt → RAG → LLM → respuesta    │                  ││
│  │   └────────────────────────────────────┘                  ││
│  │                                                          ││
│  │   env-loader.ts ◄──── .env / settings                    ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## 2026-07-08 — Fix: "failed to fetch" + botones sin efecto

### Problema 1: "failed to fetch" en OpenCode y orquestación
Los comandos "Probar chat" y "Orquestar" fallaban con **"failed to fetch"** dentro de Obsidian, aunque funcionaban correctamente desde PowerShell/Node.js.

### Causa raíz
Ambos clientes (`OpenCodeClient` y `GeminiBalancer`) usaban la API global `fetch()` del navegador/Electron. Obsidian tiene restricciones de **Content Security Policy (CSP)** que bloquean `fetch()` para URLs externas. Desde la Consola del Desarrollador (Ctrl+Shift+I) se veía: `TypeError: Failed to fetch`.

### Solución
Reemplazar `fetch()` por `requestUrl()` del módulo `obsidian`, que es la API oficial de Obsidian para peticiones HTTP y no está sujeta a CSP:

| Archivo | Antes | Después |
|---|---|---|
| `src/embeddings/gemini-balancer.ts` | `fetch(url, { method, headers, body })` | `requestUrl({ url, method, contentType, body })` |
| `src/llm/opencode-client.ts` | `fetch(url, { method, headers, body })` | `requestUrl({ url, method, contentType, headers, body })` |

### Sidebar accessibility
- **Ribbon icon** (💬) en la barra lateral izquierda para abrir el chat
- **Botones de prueba** en la vista de chat: embeddings, chat, orquestar, settings
- **Botones de prueba** en la solapa de Settings
- Los comandos de prueba ahora muestran un Notice persistente "Llamando a OpenCode..." mientras esperan, y reemplazan el mensaje al recibir respuesta o error

### Problema 2: Botones de prueba no respondían al click
Los botones en el panel de chat y en Settings no ejecutaban ninguna acción al presionarlos.

**Causa raíz:** Usaban `executeCommandById("sanctum-test-embeddings")` — los IDs de comando en Obsidian llevan el prefijo del plugin (`sanctum-ii:sanctum-test-embeddings`), pero incluso con el prefijo correcto, `executeCommandById` resuelve los comandos de forma inconsistente dentro de vistas.

**Solución:** Extraer toda la lógica de prueba a **métodos públicos** en `SanctumPlugin` (`testEmbeddings()`, `testChat()`, `runOrchestrate()`) y llamarlos directamente desde los botones via `btn.onclick = () => this.plugin.testEmbeddings()`. También se reemplazó `addEventListener("click", ...)` por `btn.onclick = ...` que es más directo y evita problemas de bindeo.

### Resultado del test (PowerShell)
```
STATUS: 200
BODY: {"id":"670c8de2-...","choices":[{"index":0,"message":{"role":"assistant","content":"Hola"}}]}
```

### Diagrama actual
```
┌──────────────────────────────────────────────────────────────┐
│                      OBSIDIAN                                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │   Sanctum II                                            ││
│  │                                                          ││
│  │   ┌──────────────┐    ┌──────────────────┐              ││
│  │   │ GeminiBalancer│    │ OpenCodeClient    │              ││
│  │   │ requestUrl()  │    │ requestUrl()      │              ││
│  │   │ → Gemini API  │    │ → OpenCode API    │              ││
│  │   └──────┬───────┘    └────────┬─────────┘              ││
│  │          │                      │                         ││
│  │          ▼                      ▼                         ││
│  │   ┌────────────────────────────────────┐                  ││
│  │   │      Orquestador mínimo            │                  ││
│  │   │  prompt → LLM → respuesta          │                  ││
│  │   └────────────────────────────────────┘                  ││
│  │                                                          ││
│  │   env-loader.ts ◄──── .env / settings                    ││
│  │                                                          ││
│  │   Acceso: Ribbon icon ◄─── Chat view ─── Botones test   ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## 2026-07-08 — Etapa 3: Agent Loader

### Cambios
- `src/agents/types.ts` — interfaz `AgentDefinition` con `id`, `name`, `avatar`, `model`, `permissions`, `system_prompt`
- `src/agents/agent-loader.ts` — parsea `sanctum-agents/agente_base.md` (frontmatter YAML + cuerpo del prompt)
- `src/main.ts` — usa `loadAgentFromVault()` al iniciar; reemplaza el `SYSTEM_PROMPT` hardcodeado por el del agente real

### Decisión técnica
- **Formato de agente:** archivo `.md` con frontmatter YAML separado por `---`, idéntico al formato definitivo del diseño completo (se reusa en fases posteriores)
- **Parser:** manual (sin librería YAML externa) para mantener el bundle liviano; soporta strings, arrays, booleanos y números
- **Fallback:** si el archivo no existe o tiene error, se usa un system prompt hardcodeado genérico
- **Renderizado:** la función `renderSystemPrompt()` reemplaza `{{rag_context}}` y `{{user_prompt}}` en el cuerpo del agente

### Flujo actual
```
Plugin carga
  └─ vault.adapter.read("sanctum-agents/agente_base.md")
       └─ parseAgentMd() → AgentDefinition { id, name, model, permissions, system_prompt }
            └─ Se usa en testChat(), runOrchestrate(), sendChatMessage()
                 └─ renderSystemPrompt(agent, ragContext, userPrompt) → prompt final
```

### Diagrama actualizado
```
┌──────────────────────────────────────────────────────────────┐
│                      OBSIDIAN                                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │   Sanctum II                                            ││
│  │                                                          ││
│  │   vault/sanctum-agents/agente_base.md                    ││
│  │         │                                                ││
│  │         ▼                                                ││
│  │   Agent Loader ───► AgentDefinition                      ││
│  │   (parsea YAML      { id, name, model,                   ││
│  │    + body .md)        system_prompt,                     ││
│  │                       permissions }                      ││
│  │         │                                                ││
│  │         ▼                                                ││
│  │   renderSystemPrompt(agent, ctx, prompt)                 ││
│  │         │                                                ││
│  │         ▼                                                ││
│  │   ┌──────────────┐    ┌──────────────────┐              ││
│  │   │ GeminiBalancer│    │ OpenCodeClient    │              ││
│  │   │ requestUrl()  │    │ requestUrl()      │              ││
│  │   │ → Gemini API  │    │ → OpenCode API    │              ││
│  │   └──────┬───────┘    └────────┬─────────┘              ││
│  │          │                      │                         ││
│  │          ▼                      ▼                         ││
│  │   ┌────────────────────────────────────┐                  ││
│  │   │      Orquestador mínimo            │                  ││
│  │   │  prompt renderizado → LLM → resp   │                  ││
│  │   └────────────────────────────────────┘                  ││
│  │                                                          ││
│  │   Acceso: Ribbon icon ◄─── Chat view ─── Botones test   ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

---

## 2026-07-08 — Etapa 4: Vector store + Indexador + RAG

### Cambios
- `src/rag/vector-store.ts` — `VectorStore` class con persistencia JSON:
  - `addChunks()`, `search(queryEmbedding, topK)` con cosine similarity
  - `filterByPaths(results, allowedPaths)` con glob patterns (`/**`, `*.md`)
  - `load()/save()` contra `sanctum-logs/vector-store.json`
- `src/rag/indexer.ts` — `indexResearchFolder()`:
  - Lista archivos `.md` en `/Research/`
  - Chunking por ~400 palabras
  - Genera embeddings vía `GeminiBalancer`
  - Almacena en `VectorStore`
- `src/main.ts`:
  - Comando `"Indexar carpeta /Research/"` (📚)
  - Comando `"Buscar en /Research/ (RAG)"` (🔍)
  - Orquestador: ahora inyecta contexto RAG real antes de llamar al LLM
  - Filtro de permisos: aplica `permissions.read_paths` del agente a los resultados RAG

### Decisión técnica
- **Formato de store:** JSON en lugar de sqlite-vec por pragmatismo MVP — cero dependencias nativas, fácil debug, reemplazable después
- **Búsqueda:** cosine similarity brute-force sobre todos los chunks (OK para < 1000 chunks)
- **Chunking:** 400 palabras por chunk, división simple por whitespace
- **Permisos:** glob-to-regex traduce patrones como `/**` o `/Research/**` a regex

### Flujo completo actual
```
Usuario pregunta
  └─ GeminiBalancer.embed(pregunta) → vector
       └─ VectorStore.search(vector, topK=5) → chunks con score
            └─ VectorStore.filterByPaths(chunks, read_paths) → solo chunks permitidos
                 └─ renderSystemPrompt(agent, chunks_formateados, pregunta)
                      └─ OpenCodeClient.chat(prompt_renderizado)
                           └─ Respuesta al usuario
```

### Diagrama actual
```
┌──────────────────────────────────────────────────────────────┐
│                      OBSIDIAN                                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │   Sanctum II                                            ││
│  │                                                          ││
│  │   vault/Research/*.md                                    ││
│  │         │                                                ││
│  │         ▼                                                ││
│  │   indexer.ts ──── chunk → Gemini → VectorStore.json     ││
│  │                          embed                           ││
│  │                              │                            ││
│  │   user prompt ──── Gemini ───┤                            ││
│  │                    embed     │                            ││
│  │                              ▼                            ││
│  │   vector-store.ts: search() + filterByPaths()            ││
│  │                              │                            ││
│  │                              ▼                            ││
│  │   renderSystemPrompt(agent, ragContext, userPrompt)       ││
│  │                              │                            ││
│  │                              ▼                            ││
│  │   OpenCodeClient.chat() ────► deepseek-v4-flash          ││
│  │                              │                            ││
│  │                              ▼                            ││
│  │   Respuesta con contexto real del vault                  ││
│  │                                                          ││
│  │   Agente: sanctum-agents/agente_base.md                  ││
│  │   Store: sanctum-logs/vector-store.json                  ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## 2026-07-08 — Etapa 6: NoteWriter + escritura al vault

### Cambios
- `src/core/note-writer.ts` — clase `NoteWriter`:
  - `create(path, content)` — crea nota, error si ya existe
  - `update(path, content)` — reescribe nota existente
  - `append(path, content)` — agrega al final (crea si no existe)
  - `replace(path, search, replacement)` — reemplaza texto
  - Todas acceden al vault via `vault.adapter`
- `src/main.ts`:
  - Nuevo botón "✏️ Crear nota con IA" — el agente genera contenido y `NoteWriter` lo guarda en `/Research/`
  - Nuevos comandos: `"Generar nota con IA"`, `"Agregar contenido a una nota existente"`
  - `sendChatMessage()` ahora detecta frases como "creá una nota llamada X" y ejecuta la escritura automáticamente
  - `writeNoteIfRequested()` parsea el usuario: `creá una nota [nombre] sobre [tema]` → genera con IA → escribe

### Decisión técnica
- **Escritura condicional:** el agente no escribe espontáneamente — el usuario debe pedirlo explícitamente ("creá una nota...")
- **Detección por regex:** `createNoteIfRequested()` usa regex para capturar nombre y tema del mensaje
- **Path:** todas las notas se crean en `/Research/` por ahora (consistente con el alcance del MVP)

### Flujo de escritura
```
Usuario: "creá una nota resumen.md sobre machine learning"
  └─ sendChatMessage()
       └─ writeNoteIfRequested()
            ├─ regex detecta "creá una nota resumen.md sobre machine learning"
            ├─ → instruction: "Generá contenido detallado sobre machine learning"
            ├─ → OpenCodeClient.chat() genera contenido
            └─ → NoteWriter.create("Research/resumen.md", contenido)
                 └─ vault.adapter.write()
                      └─ Nota creada en el vault
```

### Diagrama actual
```
┌──────────────────────────────────────────────────────────────┐
│                      OBSIDIAN                                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │   Sanctum II                                            ││
│  │                                                          ││
│  │   Usuario: "creá una nota X sobre Y"                    ││
│  │         │                                                ││
│  │         ▼                                                ││
│  │   writeNoteIfRequested()                                 ││
│  │    ├─ regex match nombre/tema                            ││
│  │    ├─ agent genera contenido                             ││
│  │    └─ NoteWriter.create(path, content)                   ││
│  │         │                                                ││
│  │         ▼                                                ││
│  │   vault.adapter.write("Research/X.md")                   ││
│  │                                                          ││
│  │   También disponible vía botón o comando directo        ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Etapa 7 — Observabilidad (Tracer)

**Archivo:** `src/observability/tracer.ts`

**Qué hace:**
- `Tracer` class que genera `trace_id` (UUID v4), registra `input`, `output`, `duration_ms`, `chunks` (RAG fragments), `status` y metadatos de cada invocation del agente.
- Escribe cada trace como JSON en `sanctum-logs/traces/<trace_id>.json`.
- Métodos: `start(agentId, systemPrompt, userInput) → traceId`, `addChunk({source, chunk, similarity_score, from_note})`, `finish(output, extra?)`, `abort(error)`.

**Wiring en main.ts:**
- `tracer` se instancia en `onload()` y se inyecta en `sendChatMessage`, `runOrchestrate`, `createNoteWithAI`, `executeWriteIntent`, `indexResearch`.
- Cada entry point crea un trace, registra chunks RAG si se usaron, y llama `finish()` con el output o `abort()` si hay error.

**Formato del trace:**
```json
{
  "trace_id": "uuid",
  "agent_id": "agente_base",
  "system_prompt": "...",
  "user_input": "...",
  "output": "...",
  "duration_ms": 1234,
  "timestamp": "2026-07-08T06:00:00.000Z",
  "status": "success",
  "chunks": [
    { "source": "rag", "chunk": "...", "similarity_score": 0.85, "from_note": "Research/foo.md" }
  ],
  "metadata": {}
}
```

### Fix: write_paths enforcement

**Archivos:** `src/main.ts`, `src/rag/vector-store.ts`

**Qué se arregló:**
- `write_paths` se parseaba del frontmatter del agente pero **nunca se consultaba** antes de escribir. `executeWriteIntent()`, `createNoteWithAI()` y el branch `append` de `sendChatMessage()` escribían al vault sin verificar permisos.
- Se agregó el helper `canWriteTo(path)` que compara contra `agent.permissions.write_paths` usando glob matching.
- Ahora todas las operaciones de escritura (create, update, append) fallan con mensaje claro si `write_paths` no cubre la ruta destino.
- También se arregló `globMatch()` para que `/**` y `/Research/**` matcheen paths relativos (antes el `/` inicial impedía el match con paths como `Research/foo.md`).

**Nota sobre alcance:** La Etapa 6 (NoteWriter) es un adelanto intencional sobre el MVP — la sección 8 del MVP dice "el MVP no escribe al vault todavía". Se decidió mantenerlo porque ya funciona y no interfiere con el loop de validación central (RAG → permisos → agente).

### MVP validado

**Fecha:** 2026-07-08

**Criterios de éxito (sección 8 de Sanctum-II-MVP.md):**

| # | Criterio | Resultado |
|---|---|---|
| 1 | Notas en /Research/ | ✅ (2 notas de prueba) |
| 2 | Indexación RAG | ✅ (chunks + embeddings en vector-store.json) |
| 3 | Pregunta a @agente_base | ✅ (OpenCode chat + system prompt renderizado) |
| 4 | Orquestador: RAG → permisos → agente | ✅ (filtro testado con read_paths: ["/Research/**"]) |
| 5 | Respuesta usa contenido real de notas | ✅ (chunks inyectados en el prompt) |
| 6 | Trace completo en sanctum-logs/traces/ | ✅ (Etapa 7 wiring completo) |

**MVP cerrado.** Continuando con desarrollo post-MVP.

### Etapa 8 — UI de chat funcional

**Archivo:** `src/main.ts` (clase `SanctumChatView`)

**Cambios:**
- **Historial de mensajes:** se mantiene un array `ChatMessage[]` en memoria y se renderiza completo en cada actualización.
- **Burbujas con estilo diferenciado:** usuario alineado a la derecha con color accent, agente alineado a la izquierda con fondo secundario.
- **Renderizado Markdown:** las respuestas del agente se renderizan con `MarkdownRenderer.renderMarkdown()` de Obsidian (soporta bold, lists, code blocks, links, etc).
- **Auto-scroll:** al agregar un mensaje, el contenedor scrollea al fondo.
- **Mensaje de "pensando..."** se muestra mientras el agente responde y se reemplaza por la respuesta real.
- **Toolbar simplificado:** botones esenciales (Indexar, RAG, Nota IA) sin redundancias.

### Refactor 2: extracción profunda de main.ts

**Archivos creados:**
- `src/core/commands.ts` — `registerCommands(plugin)` extrae los 7 `addCommand` de `onload`
- `src/core/tests.ts` — `testEmbeddings()`, `testChat()`, `ragQuery()` como funciones puras (sin dependencia del plugin)
- `src/orchestrator/note-generator.ts` — `executeWriteIntent()`, `createNoteAction()`, `canWriteToPath()`, `makeInstruction()` consolida la lógica de generación de notas (LLM → permisos → escritura → trace)

**Cobertura de extracción:**

| Pieza | Antes (en main.ts) | Ahora |
|---|---|---|
| Objeto fallback | 5 copias inline | `fallbackAgent()` en `src/agents/fallback.ts` |
| Comandos | 7 bloques en `onload` | `registerCommands()` en `src/core/commands.ts` |
| Tests (embeddings, chat, RAG) | 3 métodos en plugin | funciones puras en `src/core/tests.ts` |
| Generación de notas | `executeWriteIntent` + `createNoteWithAI` | `src/orchestrator/note-generator.ts` |
| Orquestación RAG | inline en 2 métodos | `executeTurn()` en `src/orchestrator/agent-turn.ts` |
| UI Chat | class entera | `src/ui/chat-view.ts` |
| UI Settings | class entera | `src/ui/settings-tab.ts` |
| Constantes | inline | `src/constants.ts` |
| Utilidades | inline | `src/utils.ts` |

**main.ts bajó de ~700 → ~300 líneas.** Solo contiene plugin lifecycle (onload, loadAgent, getters), propiedades públicas y wrappers finos que delegan en los módulos extraídos.

**Arquitectura actual (20 archivos, ~1827 líneas total):**
```
src/
├── main.ts                   300  Plugin lifecycle + thin delegation + runMesh
├── constants.ts               14  VIEW_TYPE_SANCTUM, SanctumSettings, DEFAULT_SETTINGS
├── utils.ts                   28  globMatch, slugify, extractTitle
├── agents/
│   ├── types.ts               16  AgentDefinition interface
│   ├── fallback.ts            17  FALLBACK_SYSTEM_PROMPT, fallbackAgent()
│   └── agent-loader.ts        79  loadAgentFromVault(fileName?), renderSystemPrompt
├── core/
│   ├── env-loader.ts          45  getEnv from .env + process.env
│   ├── note-writer.ts        102  NoteWriter (create/update/append/replace)
│   ├── commands.ts            65  registerCommands() — 8 comandos
│   └── tests.ts               48  testEmbeddings, testChat, ragQuery
├── embeddings/
│   └── gemini-balancer.ts    114  GeminiBalancer con rotación de keys
├── llm/
│   └── opencode-client.ts     79  OpenCodeClient (deepseek-v4-flash)
├── orchestrator/
│   ├── agent-turn.ts          50  executeTurn() — RAG→render→chat + MIN_SIMILARITY
│   ├── note-generator.ts      77  executeWriteIntent + createNoteAction + canWriteToPath
│   └── mesh.ts                60  runForagerResearcherMesh — 2-step mesh
├── rag/
│   ├── vector-store.ts       236  VectorStore JSONL + Base64 + tombstones + compaction
│   └── indexer.ts             71  indexResearchFolder() — addChunks(noteName)
├── ui/
│   ├── chat-view.ts          239  SanctumChatView + toggle mesh + trace viewer + clipboard
│   └── settings-tab.ts        86  SanctumSettingTab + SettingsTabPlugin interface
└── observability/
    └── tracer.ts             101  Tracer (UUID + traces en sanctum-logs/)
```

**Archivos creados:**
- `src/constants.ts` — `VIEW_TYPE_SANCTUM`, `SanctumSettings`, `DEFAULT_SETTINGS`
- `src/utils.ts` — `globMatch()`, `slugify()`, `extractTitle()`
- `src/agents/fallback.ts` — `FALLBACK_SYSTEM_PROMPT`, `fallbackAgent()` (elimina 5 duplicaciones del objeto fallback)
- `src/orchestrator/agent-turn.ts` — `executeTurn()` (encapsula RAG→render→chat, usado por `sendChatMessage` y `runOrchestrate`)
- `src/ui/chat-view.ts` — `SanctumChatView` con interfaz `ChatViewPlugin` (evita dependencia circular)
- `src/ui/settings-tab.ts` — `SanctumSettingTab` con interfaz `SettingsTabPlugin`

**Cambios en `src/main.ts`:**
- Se redujo de ~700 a ~300 líneas
- `SanctumPlugin` implementa `ChatViewPlugin` y `SettingsTabPlugin`
- Método helper `agentOrFallback` reemplaza las 5 repeticiones del objeto fallback

**Comportamiento preservado:** cero cambios en lógica de negocio. La UI, el tracer, el RAG y la escritura funcionan exactamente igual.

### Paso 4 — Mesh Forager → Researcher

**Archivos creados/modificados:**
- `src/agents/agent-loader.ts` — `loadAgentFromVault()` ahora acepta `fileName` opcional (default `agente_base.md`)
- `sanctum-agents/forager.md` — agente Forager (🔍, reformula prompts + RAG)
- `sanctum-agents/researcher.md` — agente Researcher (📚, produce respuesta final)
- `src/orchestrator/mesh.ts` — `runForagerResearcherMesh()` ejecuta el mesh de 2 pasos con trace propio

**Flujo del mesh:**
```
Usuario pregunta
  └─ Forager (load + executeTurn)
       ├─ RAG sobre /Research/ (filtrado por read_paths: ["/Research/**"])
       ├─ reformula el prompt con contexto del vault
       └─ output → prompt de investigación mejorado
  └─ Researcher (load + executeTurn)
       ├─ recibe el prompt reformulado de Forager
       ├─ RAG sobre /Research/ (mismo filtro)
       └─ produce respuesta final completa
  └─ Trace único del mesh (forager_tokens + researcher_tokens)
```

**Sin cambios en main.ts** — el mesh se ejecuta independientemente. Solo se necesita un botón o comando que llame a `runForagerResearcherMesh()`.

### Fix: Encoding U+FFFD en vector store

**Archivos:** `sanctum-logs/vector-store.json`, `Research/Machine Learning.md`

**Problema:**
Los chunks del vector store contenían caracteres corruptos (U+FFFD / replacement character) en lugar de acentos y ñ: `ó` → `\ufffd`, `é` → `\ufffd`, `ñ` → `\ufffd`. El agente recibía contexto con texto roto y reproducía la corrupción en sus respuestas.

**Investigación:**
1. Se sospechó de `requestUrl().json` — se intentó reemplazar por `TextDecoder(response.arrayBuffer)` con UTF-8 explícito en `opencode-client.ts`.
2. Tras confirmar que el problema persistía, se inspeccionó `vector-store.json` directamente: los chunks ya contenían U+FFFD en disco.
3. Se leyó `Research/Machine Learning.md` desde el vault con `vault.adapter.read()` → el contenido ya estaba corrupto en el archivo fuente.

**Causa raíz:**
Los archivos `.md` del vault fueron escritos con encoding corrupto en algún momento (probablemente durante una copia/transferencia). No era un bug del API ni del parser — era el contenido en disco.

**Solución:**
1. Se eliminó `sanctum-logs/vector-store.json` (chunks corruptos).
2. Se recreó `Research/Machine Learning.md` con UTF-8 limpio (caracteres correctos).
3. Se revirtió `opencode-client.ts` a `response.json` (el `TextDecoder` no era necesario).
4. Re-indexación pendiente — el usuario debe ejecutar el comando "Indexar carpeta /Research/" para reconstruir el store.

**Lección:** Verificar el contenido en disco antes de asumir que el problema está en el parsing o transporte. El U+FFFD aparece cuando un decoder UTF-8 encuentra bytes inválidos — si está en el archivo fuente, ningún cambio en el código de transporte lo arregla.

### Decisión técnica: MIN_SIMILARITY = 0.65

**Archivos:** `src/orchestrator/agent-turn.ts`, `src/core/tests.ts`

**Qué se agregó:**
- Constante `MIN_SIMILARITY = 0.65` que filtra chunks RAG con cosine similarity por debajo del threshold.
- En `executeTurn()`: los chunks con score < 0.65 se descartan antes de inyectarse en el system prompt.
- En `ragQuery()` (tests): mismo filtro para consistencia.

**Justificación:**
Sin filtro, el RAG inyecta chunks irrelevantes (score 0.3-0.5) que ensucian el contexto y confunden al modelo. 0.65 es un balance empírico: suficientemente bajo para no perder resultados边际 relevantes, suficientemente alto para descartar ruido. Ajustable en el futuro vía settings si es necesario.

### UI: Toggle mesh button + trace viewer + clipboard + labels

**Archivos:** `src/ui/chat-view.ts`, `src/main.ts`

**Cambios:**

| Feature | Implementación |
|---|---|
| **Toggle mesh mode** | Botón 🔀 en la toolbar que activa/desactiva `meshMode` flag. `dispatchSend()` rutea a `runForagerResearcherMesh()` o `sendChatMessage()` según el estado. Usa `onclick`/`onkeydown` directo (no `addEventListener`, que no funciona en botones `createEl` de Obsidian). |
| **Trace viewer** | Botón "📋 Último trace" que muestra: prompt original, forager output, researcher output, chunks RAG con scores. Usa `plugin.getLatestTrace()`. |
| **Clipboard en mensajes** | Botón 📋 debajo de cada mensaje. Copia el contenido al portapapeles con feedback visual ✅. |
| **Labels por agente** | Mensajes muestran etiqueta según el agente que los generó: "🤖 Agente Base", "🔍 Forager → 📚 Researcher", "📋 Tracer". |

**Bug corregido — addEventListener vs onclick:**
`addEventListener("click", ...)` no dispara en botones creados con `createEl("button")` dentro de Obsidian. Solución: asignar `btn.onclick = () => ...` directamente, o usar toggle mode con `onkeydown` para Enter.

### Debug: MESH_STARTED.txt

**Archivo:** `src/orchestrator/mesh.ts`

`runForagerResearcherMesh()` escribe un archivo `MESH_STARTED.txt` en la raíz del vault al iniciar, como señal de debug para confirmar que el mesh se ejecutó. **Debe eliminarse** una vez validado el flujo.

### Vector Store: rewrite a log transaccional JSONL + Base64

**Archivos:** `src/rag/vector-store.ts` (102 → 236 líneas), `src/rag/indexer.ts`

**Problema:**
El vector store usaba un único archivo JSON plano (`vector-store.json`) con todos los chunks cargados en memoria y reescritos enteros en cada `save()`. Esto causaba:
1. **Lag en Obsidian** — reescribir el archivo completo en cada indexación bloqueaba la UI.
2. **No soportaba reindexación incremental** — al reindexar una nota, los chunks viejos no se eliminaban; se acumulaban duplicados.
3. **Peso excesivo** — cada vector de 768 floats ocupaba ~9-10KB en texto JSON (números separados por comas).

**Solución — log transaccional append-only en JSONL:**

El almacenamiento ahora apunta a `sanctum-logs/vector-store.jsonl`. Cada línea es una operación atómica:

```
{"t": "set", "id": "chunk_id", "p": "note_path", "txt": "chunk_text", "v": "base64_embedding"}   ← insert/update
{"t": "del", "id": "chunk_id"}                                                                    ← tombstone
```

**Codificación Base64 de Float32:**
- `float32ArrayToBase64()`: `Float32Array` (768 floats → 3072 bytes) → `btoa()` → string Base64 de **~4KB** (vs ~9-10KB en texto JSON).
- `base64ToFloat32Array()`: decodificación inversa con `atob()` al cargar.

**Tombstones (lápidas):**
- Al cargar (`load`), se lee el `.jsonl` línea por línea. Registros `set` añaden al `chunksMap`; registros `del` eliminan del mapa. Esto reconstruye el estado correcto al arrancar, incluso si notas fueron editadas/eliminadas.
- `noteToChunksMap` rastrea qué IDs de chunks pertenecen a cada ruta de nota. Al reindexar una nota, `addChunks()` genera automáticamente tombstones `del` para los chunks viejos antes de escribir los nuevos `set`.

**Escritura eficiente (`save`):**
- `addChunks()` solo genera líneas de transacción en memoria (`pendingTxns`) sin tocar disco.
- `save()` hace `append` al final del `.jsonl` — **< 1ms**, sin lag.
- `clear()` activa `shouldTruncate = true`. La próxima vez que se guarde, el archivo se reescribe limpio desde cero (compacción automática: elimina tombstones y registros redundantes de notas que ya no existen).

**Cambio en el indexador (`src/rag/indexer.ts`):**
- `store.addChunks(newChunks, noteName)` ahora recibe la ruta del archivo MD. Esto permite al vector store ejecutar la limpieza automática de chunks viejos (generar tombstones `del`) antes de escribir los nuevos, incluso si la nota fue vaciada completamente.

**Estructura en memoria:**
```
VectorStore
  ├── chunksMap: Map<id, Chunk>          ← estado activo reconstruido del log
  ├── noteToChunksMap: Map<path, Set<id>> ← rastrea chunks por nota
  ├── chunks: Chunk[]                     ← array para búsqueda (cosine similarity)
  ├── pendingTxns: string[]               ← transacciones pendientes de flush
  └── shouldTruncate: boolean             ← bandera de compacción
```

### Etapa 14 — @ mention autocomplete dropdown

**Archivos:** `src/ui/chat-view.ts`, `styles.css`

**Cambios:**
- Dropdown flotante cuando el usuario escribe `@` en el input del chat
- Fuentes mezcladas: agentes de `sanctum-agents/` (avatar + nombre) + notas del vault (título + ruta)
- Control por teclado: ArrowUp/Down, Enter/Tab, Escape
- Las opciones de agente insertan `@id`, las de nota insertan `[[ruta]]`
- Activación inteligente: solo al inicio del mensaje o después de un espacio (evita correos electrónicos)

### Etapa 15 — Orquestador + Critic + loop con threshold

**Archivos creados/modificados:**
- `sanctum-agents/critic.md` — nuevo agente del sistema con `internal: true`
- `src/agents/types.ts` — campo `internal?: boolean` en `AgentDefinition`
- `src/agents/agent-loader.ts` — parsea `internal` del frontmatter
- `src/orchestrator/mesh.ts` — reemplaza `runForagerResearcherMesh()` por `runMeshWithCritic()` con loop Researcher↔Critic
- `src/ui/chat-view.ts` — filtra `internal: true` del autocompletado @, actualiza `handleMesh()` para nuevo resultado
- `src/main.ts` — `runMesh()` retorna `MeshResultFull`, actualizado `getLatestTrace()` para nuevo formato
- `docs/registro-arquitectura.md` — esta entrada

**Estructura de datos — LoopState:**
```typescript
interface LoopState {
  original_prompt: string;
  current_step: "forager" | "research" | "critic_review" | "done" | "escalated";
  attempt: number;
  max_attempts: number;  // 3
  history: Array<{
    agent: string;
    output: string;
    score?: number;
    verdict?: "accept" | "reject";
    feedback?: string[];
  }>;
}
```

**Flujo del orquestador:**
```
Usuario pregunta
  └─ Forager (1 vez) → reformula prompt + RAG
       └─ Researcher (intento N, hasta 3) → produce investigación
            └─ Critic evalúa con 5 criterios (20 pts c/u)
                 ├─ score ≥ 80 → ACCEPT → devuelve resultado
                 └─ score < 80 → feedback → Researcher regenera (N+1)
                                    └─ si N >= 3 → ESCALATE al usuario
```

**Schema de evaluación del Critic (JSON):**
```json
{
  "evaluation": {
    "criteria": [
      { "name": "coherencia_interna", "score": 18 },
      { "name": "uso_de_fuentes", "score": 15 },
      { "name": "completitud_vs_prompt", "score": 20 },
      { "name": "actualidad_de_datos", "score": 10 },
      { "name": "claridad_de_escritura", "score": 17 }
    ],
    "total_score": 80,
    "threshold": 80,
    "verdict": "accept",
    "feedback_for_regeneration": ["..."]
  }
}
```

**Fallback:** Si el LLM no devuelve JSON parseable, `parseCriticJSON()` retorna `{ verdict: "accept", total_score: 80 }` para no bloquear al usuario.

**UI en modo mesh:** Labels muestran `🔍 Forager → 📚 Researcher (×N) → ⚖️ Critic`. Si el mesh escala, se muestra un mensaje especial con el mejor intento, score y feedback.

## Roadmap técnico

| Etapa | Componente | Estado | Depende de |
|---|---|---|---|
| 0 | Setup plugin Obsidian | ✅ | — |
| 1 | Gemini proxy-balancer | ✅ | Etapa 0 |
| 2 | Conector OpenCode chat | ✅ | Etapa 0 |
| 3 | Agent Loader | ✅ | Etapa 2 |
| 4 | Vector store JSON + Indexador manual | ✅ | Etapa 1, 3 |
| 5 | RAG query + filtro de permisos | ✅ | Etapa 4 |
| 6 | Orquestador con escritura de notas | ✅ (adelanto) | Etapa 3, 5 |
| 7 | Observabilidad (traces en sanctum-logs/) | ✅ | Etapa 6 |
| 8 | UI de chat funcional | ✅ | Etapa 7 |
| 9 | Mesh Forager → Researcher | ✅ | Etapa 8 |
| — | MIN_SIMILARITY = 0.65 (filtro RAG) | ✅ | Etapa 5 |
| — | write_paths enforcement + globMatch fix | ✅ | Etapa 6 |
| — | Encoding fix (U+FFFD en vector store) | ✅ | Etapa 4 |
| — | Toggle mesh + trace viewer + clipboard | ✅ | Etapa 9 |
| — | Vector Store JSONL + Base64 + tombstones | ✅ | Etapa 4 |
| 10 | Re-indexar /Research/ (vector-store borrado) | ⏳ Pendiente | Encoding fix |
| 11 | Web search como tool de agente | 🔲 | Etapa 9 |
| 12 | Persistencia del historial del chat | 🔲 | Etapa 8 |
| 13 | Tests automatizados | 🔲 | — |
| 14 | Selector de agente en la UI (@ mention) | ✅ | Etapa 8 |
| 15 | Orquestador + Critic + loop con threshold | ✅ | Etapa 9 |
| 16 | Knowledge Graph semántico | 🔲 | Etapa 4 |
| 17 | Memoria persistente por proyecto | 🔲 | Etapa 8 |
| 18 | Indexado incremental automático (`vault.on('modify')`) | 🔲 | Vector Store JSONL |
| 19 | Skills (personales y generales) | 🔲 | Etapa 15 |
| — | Limpiar MESH_STARTED.txt debug file | ✅ | — |

---
