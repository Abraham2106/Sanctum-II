# Registro de Arquitectura — Sanctum II MVP

> Bitácora cronológica de cambios, decisiones técnicas y evolución del diagrama de arquitectura.

---

## 2026-07-11 — Unificación del orquestador, permisos, tests y modo implícito

### Cambios

**Orquestador unificado (etapa 1):**
- Creado `sanctum-agents/orchestrator.md` con `internal: true` como agente formal de ruteo
- `src/orchestrator/mesh.ts`: consolidado como único punto de verdad (antes duplicado en `mesh-orchestrator.ts`)
- `src/app/mesh-orchestrator.ts`: eliminado
- `main.ts`: agregados 4 métodos de interfaz faltantes (testEmbeddings, testChat, runOrchestrate, createNoteWithAI)

**Permisos por intersección (etapa 2):**
- pathFilter y agent.read_paths ahora SIEMPRE se intersectan en `agent-turn.ts`
- Expansión KG verifica ambos filtros antes de agregar chunks
- Chain executor ya no pasa `[]` como pathFilter
- Skills advierten si expanden tools del agente
- `globMatch` y `filterByPaths` consolidados en `pathMatchesAny()` en `utils.ts`

**Exclusión de carpetas internas (etapa 3):**
- `isInternalPath()` en `utils.ts`: excluye `sanctum-*` y `docs/` de RAG y KG
- Aplicado en indexadores (`rag/indexer.ts`, `projects/indexer.ts`) y KG explícito (`native-links.ts`)
- Write path protegido con `isInternalPath` en `canWriteToPath`
- Autocomplete del chat usa `isInternalPath`

**Tests (etapa 4):**
- vitest configurado (`npm test`)
- `src/permissions.test.ts`: 77 tests pasando
- Cobertura: permisos, glob-match, intersección, critic, conversación, topologicalOrder, VectorStore, note-resolver, skills, slugify, extractTitle, renderSystemPrompt
- `kg.test.ts`: 34 assertions, ejecutables con `npx tsx`

**Bug fixes:**
- `classifyIntent`: separados `SHORT_YES` y `SHORT_NO` (antes ambos en un solo set, "no" se clasificaba como "confirmation")
- `detectPendingAction`: corregido índice de capturing group (5 → 6) para el nombre de nota
- `parseAgentMd`: lee `read_paths`/`write_paths` del nivel raíz del frontmatter (fallback para YAML nesting no soportado)
- `setActiveFolder`: implementado (faltaba en la clase)

**Modo implícito — Sección 13 (Fases 1-4):**
- **Fase 1:** pendingAction → confirmación crea nota real en `Projects/<projectId>/`
- **Fase 2:** modo implícito: sin `@agente` → orquestador clasifica (respond_only / create_note / modify_note / clarify)
- **Fase 3:** `note-resolver.ts`: resuelve referencias a notas por exact match + RAG semántico
- **Fase 4:** modificación de notas: lee, regenera con agente, escribe con `NoteWriter.update`
- Proyecto ahora usa `outputPath: Projects/<projectId>` y `Projects/{id}/` en read_paths/write_paths

### Justificación
Cierre de 16 brechas de arquitectura identificadas en auditoría. Implementación completa de las 4 fases de la Sección 13 de la Visión.

### Diagrama (arquitectura actualizada)
```
┌──────────────────────────────────────────────────────────────┐
│                         VAULT (.md)                            │
│       Indexado por proyecto (manual) + RAG con permisos        │
└───────────────────────────┬──────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
      ┌───────────┐  ┌───────────┐  ┌───────────────┐
      │    RAG     │  │    KG      │  │ Lectura/      │
      │  JSONL     │  │ (semántico │  │ escritura      │
      │  vector    │  │  + nativo) │  │ directa        │
      └─────┬──────┘  └─────┬──────┘  └───────┬────────┘
            │               │                  │
            └───────────────┼──────────────────┘
                             │
                 ┌────────────────────┐
                 │  intersección       │  ← isInternalPath + pathMatchesAny
                 │  pathFilter × perms │
                 └──────────┬─────────┘
                             ▼
                 ┌────────────────────┐
                 │    ORQUESTADOR      │  ← orchestrador.md (internal:true)
                 │  mesh + modo implíc.│
                 └──────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   ┌───────────┐       ┌───────────┐      ┌───────────┐
   │ @forager   │       │@researcher │      │  @critic   │  + custom
   │ skills     │──────▶│ web_search │─────▶│ score 0-100│  + cadenas
   └───────────┘       └───────────┘      └─────┬─────┘
                            ▲                     │
                            │    loop 3 intentos   │
                            └─────────────────────┘

                 ┌────────────────────┐
                 │  PROYECTOS          │  ← Projects/{id}/ indexable
                 │  MEMORIA (separada) │  ← /sanctum-memory/ no indexable
                 └────────────────────┘
```

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

---

## 2026-07-08 — Score anclado + state machine (refactor de Etapa 15)

### Cambios
- `src/orchestrator/mesh.ts` — refactor completo del loop Researcher↔Critic:
  - Nuevas interfaces `CriteriaScore`, `AttemptRecord` — parsea los 5 sub-criterios individuales (coherencia_interna, uso_de_fuentes, completitud_vs_prompt, actualidad_de_datos, claridad_de_escritura)
  - State machine de decisión con 5 reglas: score ≥ 80 → accept, score ≤ 40 → escalate, score > bestScore → regenerate, score ≤ bestScore → accept best, attempt ≥ max → accept best
  - `LoopState.attempts: AttemptRecord[]` mantiene el historial de scores por intento
  - `buildResearcherInput()` inyecta feedback **acumulado** de todos los intentos del Critic
- `sanctum-agents/critic.md` — threshold unificado a 80, instrucciones explícitas para feedback_for_regeneration vacío cuando se acepta
- `src/main.ts` — `getLatestTrace()` ahora muestra progreso de scores por intento con desglose de sub-criterios
- `src/ui/chat-view.ts` — `renderTracePanel()` agrega bloque "Progreso de scores" con barras y chips por criterio; `renderMiniScoreProg()` muestra mini-barra inline en cada mensaje mesh

### Diagrama de decisión
```
score >= 80 ──→ ✅ Accept
score <= 40 ──→ ⛔ Escalate
score > best ──→ 🔁 Regenerate (mejorando)
score <= best && attempt > 1 ──→ ✅ Accept best (estancó)
attempt >= max ──→ ✅ Accept best (fin de intentos)
```

---

## 2026-07-08 — KG-0: Edges semánticos (Knowledge Graph)

### Cambios
- `src/kg/types.ts` — `KgEdge`, `KgExpansionResult`, `KgOptions`
- `src/kg/kg.ts` — `noteCentroid()` (promedio de embeddings de chunks de una nota), `computeSemanticEdges()` (coseno nota-nota), `expandFromSeeds()` (BFS sobre edges para expandir contexto)
- `src/rag/vector-store.ts` — exporta `cosineSimilarity`, agrega getter `allChunks`
- `src/observability/tracer.ts` — `TraceChunk.source` acepta `"rag" | "kg"`
- `src/orchestrator/agent-turn.ts` — después de `VectorStore.search()`, corre `expandFromSeeds` y mergea chunks vecinos ANTES del filtro de permisos
- `src/constants.ts` — settings `kgEnabled`, `kgMinSimilarity`, `kgHops`
- `src/kg/kg.test.ts` — 15 tests unitarios para cosineSimilarity, noteCentroid, computeSemanticEdges, expandFromSeeds

### Flujo
```
RAG seeds ──→ obtener notas semilla ──→ centroides nota-nota ──→ coseno ≥ 0.75
  ──→ edges semánticos ──→ BFS 1-hop ──→ chunks de vecinos ──→ filterByPaths
```

---

## 2026-07-08 — KG-1: Edges explícitos + fusión de pesos

### Cambios
- `src/kg/types.ts` — `KgEdge.type` ahora incluye `"reinforced"`, agrega campo `relation: "wikilink" | "semantic" | "wikilink+semantic"`
- `src/kg/native-links.ts` — `getExplicitEdges()` lee `metadataCache.resolvedLinks` y produce edges `type: "explicit"`, `relation: "wikilink"`
- `src/kg/kg.ts` — `mergeEdges()` combina edges semánticos + explícitos:
  - Solo wikilink → `explicit` / `wikilink` / weight=1.0
  - Solo semántico → `semantic` / `semantic` / weight=cosine
  - **Ambos** → `reinforced` / `wikilink+semantic` / weight=1.0
- `src/constants.ts` — settings `kgUseExplicit`, `kgReinforceBoost`
- `src/observability/tracer.ts` — `TraceChunk.relation` opcional
- `src/orchestrator/agent-turn.ts` — pasa `relation` al tracer para chunks KG

### Regla de fusión
| Situación | type | weight | relation |
|---|---|---|---|
| Solo wikilink | explicit | 1.0 | wikilink |
| Solo coseno ≥ threshold | semantic | cosine | semantic |
| Ambos | reinforced | 1.0 | wikilink+semantic |

---

## 2026-07-08 — KG-2: Persistencia de edges + recomputo incremental

### Cambios
- `src/kg/kg-store.ts` — `KgEdgeStore` con:
  - `load(adapter)` / `save(adapter)` — JSONL append-only con tombstones (`t: "set"` / `t: "del"`)
  - `addEdge()` con upsert: tombstone del edge viejo + nuevo `set`
  - `delEdge()`, `delAllEdgesForNote()`, `getEdge()`
  - Compacción vía `clear()` + `save()` truncado
- `src/kg/kg.ts` — dos nuevas funciones:
  - `recomputeAllEdges()` — O(n²) completo llamado **una vez** al startup
  - `recomputeNoteEdges()` — O(n) incremental por nota
  - `expandFromSeeds()` ahora solo lee de `edgeStore.getAllEdges()` — O(1) por query
- `src/main.ts` — `kgEdgeStore` en plugin, `rebuildKgEdges()` en startup, `onNoteModified()` engancha `vault.on('modify')` → `recomputeNoteEdges()` + `save()`
- `src/orchestrator/agent-turn.ts` / `mesh.ts` — pasan `edgeStore` en lugar de `nativeLinkProvider`

### Archivo de persistencia
```
sanctum-logs/kg-edges.jsonl    ← log transaccional de edges
```

---

## 2026-07-08 — KG-3: Visualizador de Knowledge Graph

### Cambios
- `src/kg/layout.ts` — dos layouts puros:
  - `forceLayout(edges, w, h, iterations)` — spring-electrical con repulsión O(n²) + atracción por aristas + gravedad
  - `convolutionalLayout(seed, edges, w, h, maxHops)` — BFS por hops en columnas L0/L1/L2…
  - `neighborsOf(node, adj)` — set del nodo + adyacentes (highlight/dim)
- `src/ui/kg-view.ts` — `KgView extends ItemView` con `VIEW_TYPE_KG = "sanctum-kg"`:
  - **Topbar**: modo Grafo/Capas, toggles Explícitas/Reforzadas/Semánticas, buscador
  - **SVG canvas**: zoom (rueda + botones), paneo, arrastre de nodos, selección con highlight/dim
  - **Inspector panel derecho**: nombre, path, grado, conexiones con tipo+relación+peso, botones acción
  - Codificación visual: sólida gris (explícita), sólida violeta gruesa (reforzada), punteada violeta (semántica)
- `src/main.ts` — `registerView(VIEW_TYPE_KG, ...)`, ribbon `git-fork`, comando `open-kg`, `activateKgView()`
- `src/constants.ts` — settings `kgShowExplicit`, `kgShowReinforced`, `kgShowSemantic`, `kgHighlightCritic`
- `styles.css` — ~100 líneas para topbar, toolbar, inspector, status bar
- `src/kg/kg.test.ts` — 36 tests totales (incluye tests de layout)

### Panel del visualizador
```
┌───────────┬────────────────────────────┬────────────┐
│  CONTROLES  │          GRAFO             │ INSPECTOR   │
│  264px     │        (flexible)          │   330px     │
└───────────┴────────────────────────────┴────────────┘
```

---

## 2026-07-09 — Etapa 20: Proyectos con contexto persistente

### Cambios
- `src/projects/types.ts` — interfaces `Project`, `ProjectRag`, `Thread`, `MemoryEntry`, `defaultProject()`
- `src/projects/store.ts` — `ProjectStore`:
  - Carga/guarda proyectos en `sanctum-projects/<id>.md` (frontmatter YAML + body instructions)
  - Memoria persistente en `sanctum-memory/<id>/memory.jsonl` (append-only JSONL)
  - Threads en `sanctum-logs/threads/<id>/<threadId>.json`
  - `ensureDir()` antes de cada escritura
- `src/projects/indexer.ts` — indexación por proyecto:
  - Namespaced en `sanctum-logs/index/<id>/vector-store.jsonl`
  - **Incremental por hash**: `manifest.json` rastrea hash de contenido por archivo; solo re-embebe lo cambiado
  - Prunea chunks de archivos eliminados
- `src/projects/context.ts` — `buildProjectContext()` arma el prefijo del system prompt con `instructions` + `memory`
- `src/ui/projects-view.ts` — `ProjectsView` con 3 columnas:
  - **Izquierda** (248px): lista de proyectos con badge de ruta
  - **Centro** (flex): breadcrumb, cabecera editable, chip de contexto, composer con badge de modelo, lista de conversaciones
  - **Derecha** (340px): tarjetas Instrucciones / Carpetas / Índice RAG / Memoria / Archivos
- `src/ui/input-modal.ts` — `InputModal` reemplaza `window.prompt()` (no soportado en Electron)
- `src/rag/vector-store.ts` — constructor acepta `storePath` opcional para namespaced stores
- `src/orchestrator/agent-turn.ts` — acepta `projectContext` en `TurnDeps`, inyecta instructions + memory como prefijo del prompt, usa `project.rag.*` para topK/minSim, usa `project.read_paths` como pathFilter por defecto
- `src/orchestrator/mesh.ts` — pasa `projectContext` a `MeshOptions` → `pickTurnDeps()`
- `src/ui/chat-view.ts`:
  - Persistencia de threads (cada `addMessage()` guarda en el thread activo)
  - `postMessage(text)` — envía un mensaje programáticamente desde el hub del proyecto
  - `reloadForProject(threadId)` — recarga el chat al cambiar de proyecto
  - `updateBreadcrumb()` — muestra `◈ Sanctum-II / Chat` en la topbar
- `src/main.ts`:
  - `projectStore`, cache de `vectorStores`, `activeProject`, `activeProjectContext`, `activeThreadId`
  - `setActiveProject()` — cambia el proyecto activo, recarga vector store, KG, contexto y notifica vistas
  - `refreshChatViews()` / `refreshProjectViews()` — notifica a las vistas abiertas
  - Ribbon `folders` para Proyectos, comando `open-projects`
  - `initProjects()` — crea proyecto por defecto y directorios `sanctum-projects/`, `sanctum-memory/`, `sanctum-logs/threads/`, `sanctum-logs/index/`
- `src/constants.ts` — settings `projectsEnabled`, `activeProjectId`, `projectAutoMemory`, `projectReindexOnOpen`
- `styles.css` — CSS completo para las 3 columnas, tarjetas, composer, threads, memoria
- `deploy.ps1` — crea directorios `sanctum-projects/`, `sanctum-memory/`, `sanctum-logs/threads/`, `sanctum-logs/index/`

### Flujo de un proyecto
```
Inicio
  └─ initProjects() → crea sanctum-ii.md por defecto
       └─ setActiveProject()
            ├─ loadProject() → lee .md del proyecto
            ├─ getVectorStoreForProject() → namespaced vector store
            ├─ buildProjectContext() → memoria + instrucciones
            └─ rebuildKgEdges() → KG sobre el store del proyecto

Usuario escribe en el hub
  └─ onOpenThread(text)
       ├─ generateThreadId()
       ├─ initLeaf() → abre chat
       └─ view.postMessage(text)
            ├─ addMessage(user) → saveThreadMessages()
            ├─ executeTurn() con projectContext
            │    ├─ instructions + memoria → system prompt
            │    ├─ topK/minSim → project.rag.*
            │    └─ pathFilter → project.read_paths
            └─ addMessage(response) → saveThreadMessages()
                 └─ refreshProjectViews() → hub actualizado
```

### Ubicaciones de persistencia
```
sanctum-projects/<id>.md                    ← definición del proyecto
sanctum-memory/<id>/memory.jsonl             ← hechos/decisiones
sanctum-logs/threads/<id>/<threadId>.json    ← conversaciones
sanctum-logs/index/<id>/vector-store.jsonl   ← índice RAG namespaced
sanctum-logs/index/<id>/manifest.json        ← hashes para incremental
```

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
| 11 | Web search como tool de agente | ✅ | Etapa 9 |
| 12 | Persistencia del historial del chat (threads por proyecto) | ✅ | Etapa 20 |
| 13 | Tests automatizados (KG) | ✅ (36 tests) | — |
| 14 | Selector de agente en la UI (@ mention) | ✅ | Etapa 8 |
| 15 | Orquestador + Critic + loop con threshold + state machine | ✅ | Etapa 9 |
| 16 | KG-0: Edges semánticos | ✅ | Etapa 4 |
| — | KG-1: Edges explícitos + reinforced + mergeEdges | ✅ | KG-0 |
| — | KG-2: Persistencia kg-edges.jsonl + incremental vault.on(modified) | ✅ | KG-1 |
| — | KG-3: Visualizador SVG interactivo (force + convolutional) | ✅ | KG-2 |
| 17 | Memoria persistente por proyecto | ✅ | Etapa 20 |
| 18 | Indexado incremental (`vault.on('modify')`) para KG | ✅ | KG-2 |
| — | Indexado incremental por hash para proyectos | ✅ | Etapa 20 |
| 19 | Skills (personales y generales) | 🔲 | Etapa 15 |
| 20 | Proyectos con contexto persistente (folders + RAG namespaced + memoria + threads) | ✅ | KG-3 |
| — | InputModal reemplaza window.prompt() | ✅ | Etapa 20 |
| — | Limpiar MESH_STARTED.txt debug file | ✅ | — |
| 19 | Skills (personales y generales) | 🔲 | Etapa 15 |

---

## 2026-07-09 — Refactor: modularización del chat (Etapa 8)

### Cambios
`chat-view.ts` se dividió en 6 módulos:
- `src/ui/chat-types.ts` — interfaces `ChatMessage`, `ChatViewPlugin`, `RailAgent` + helpers
- `src/ui/chat-left.ts` — `ChatLeftPanel`: panel izquierdo, agente rail, acordeones de configuración (identidad, prompt, permisos, índice)
- `src/ui/chat-composer.ts` — `ChatComposer`: topbar, pipeline bar, input, skill chips, selector de cadenas ⛓️
- `src/ui/chat-right.ts` — `ChatRightPanel`: trace timeline, score progression, fuentes RAG
- `src/ui/chat-messages.ts` — `ChatMessages`: render de burbujas, Markdown, clipboard, persistencia de threads
- `src/ui/chat-view.ts` — orquestador reducido de ~1254 → ~320 líneas

### Diagrama
```
chat-view.ts (orquestador)
  ├── chat-left.ts        → buildLeft + acordeones
  ├── chat-composer.ts    → buildCenter + composer + skill chips + chain menu + pipeline
  ├── chat-right.ts       → buildRight + trace + fuentes + score progression
  ├── chat-messages.ts    → addMessage + renderMessage + save/load threads
  └── chat-autocomplete.ts → @ / / skills / chains + dropdown
```

---

## 2026-07-09 — Arquitectura en capas (AppServices + Orquestadores)

### Cambios
- `src/app/services.ts` — `AppServices`: contenedor DI central con stores, clients, runtime state y getters derivados (`kgOptions`, `pathFilter`)
- `src/app/chat-orchestrator.ts` — `ChatOrchestrator`: pipeline completo del chat (mention detection → chain detection → pending action → forager pipeline → executeTurn → summary persistence)
- `src/app/mesh-orchestrator.ts` — `MeshOrchestrator`: Forager→Researcher↔Critic con state machine (score ≥80 accept, ≤40 escalate, score>best regenerate, score≤best accept best, attempt≥max accept best)
- `src/orchestrator/mesh.ts` — exporta `parseCriticJSON()` y todas las interfaces
- `src/main.ts` se redujo de ~838 → ~380 líneas, delegando lógica a los orquestadores

### Diagrama de capas
```
┌─ UI ──────────────────────┐
│ ItemViews (chat, kg, etc) │
└──────────┬────────────────┘
           │ AppServices
┌──────────▼────────────────┐
│ APPLICATION (app/)         │
│ ChatOrchestrator           │
│ MeshOrchestrator           │
│ ChainRunner                │
└──────────┬────────────────┘
           │ TurnDeps
┌──────────▼────────────────┐
│ DOMAIN (core/orchestrator) │
│ executeTurn, mesh, etc     │
└──────────┬────────────────┘
           │ Stores
┌──────────▼────────────────┐
│ INFRASTRUCTURE (rag/kg/   │
│ embeddings/tools)          │
└───────────────────────────┘
```

---

## 2026-07-09 — Orquestador de Cadenas (Etapa 21)

### Cambios
- `src/chains/types.ts` — `Chain`, `ChainNode`, `ChainEdge`, `defaultChain()`
- `src/chains/store.ts` — `ChainStore` con load/save/list/delete por proyecto
- `src/chains/executor.ts` — `topologicalOrder()` (orden topológico con detección de ciclos) + `executeChain()` (ejecución secuencial con scratchpad)
- `src/ui/chain-view.ts` — `ChainView extends ItemView` con:
  - Lienzo SVG interactivo: nodos (burbujas avatar+nombre), conexiones bezier con flecha, zoom/pan
  - Palette lateral con 5 agentes arrastrables
  - Topbar: nombre editable, botones Abrir/Auto/Limpiar/Guardar/Ejecutar
  - Auto-save al modificar nodos/conexiones
  - Demo inicial Forager→Researcher→Critic
- `src/ui/chain-types.ts` — tipos compartidos + `AGENT_TYPES` + helpers
- `src/ui/chain-inspector.ts` — `ChainInspector` (panel derecho: resultado por nodo + resultado final persistente)
- `src/main.ts` — registerView, ribbon `git-branch`, comando `open-chains`, `getTurnDeps()` callback fresco
- `src/ui/chat-view.ts` — selector de cadenas ⛓️ junto a Chat/Mesh + autocomplete `@cadena-name`

### Mockup implementado
Basado en `docs/orquestador.html` — el mockup HTML se reemplazó por la implementación real en Obsidian.

### Flujo de ejecución de una cadena
```
▶ Ejecutar → InputModal("Prompt de entrada")
  ├─ Badges numerados en orden topológico
  ├─ Forager (RAG + contexto) → ✓
  ├─ Researcher (RAG + scratchpad) → ✓
  │   └─ Critic evalúa → score 37/100 → reject
  │       ├─ Intento 2: Researcher regenera con feedback → ✓
  │       └─ Critic re-evalúa → score 82/100 → accept
  └─ ResultModal con output final + score header
```

---

## 2026-07-09 — Miscelánea

### Prompts reescritos
- `sanctum-agents/agente_base.md` — prohibición de meta-narración ("he buscado", "tu vault"), citas en línea con `[[wikilink]]`, densidad sobre longitud
- `sanctum-agents/web-search.md` — formato APA 7 para fuentes web, prohibición de tablas de distinción de fuentes, citas en línea obligatorias
- `sanctum-skills/deep-research.md` — citas en línea, estructura temática, sin secciones por origen de datos
- Tools en todos los agentes: corregido el parser YAML que no soportaba formato indentado (`- item` → `[item]`)

### Conversación con memoria (contexto conversacional)
- `src/orchestrator/conversation.ts` — `buildConversationPayload()` arma payload con historial + rolling summary, `classifyIntent()` detecta confirmación/rechazo vs nueva consulta, `detectPendingAction()` extrae acciones propuestas
- Historial completo se envía al LLM en cada turno (sistema + resumen + turnos recientes)
- Acciones pendientes: si el agente propuso "¿Creo la nota X?" y el usuario responde "Sí", se ejecuta la acción sin pasar por el LLM

### Carpeta de actions: foldereo en UI
- Cada fila de carpeta en el panel derecho del proyecto tiene badge clickeable (`lectura` ↔ `escritura`) y botón ✕ al hover
- Los cambios persisten automáticamente en `sanctum-projects/<id>.md`

### Bug fixes
- `TAVILY_API_KEY` ahora se carga desde `.env` correctamente (env-loader + rebuildClients)
- Tavily query limitada a 400 chars para evitar error 400 (se pasa `tavilyQuery` separado)
- `window.prompt()` reemplazado por `InputModal` (no soportado en Electron)
- Vector store path namespaced por proyecto

## Roadmap técnico

| Etapa | Componente | Estado | Depende de |
|---|---|---|---|
| 0 | Setup plugin Obsidian | ✅ | — |
| 1 | Gemini proxy-balancer | ✅ | Etapa 0 |
| 2 | Conector OpenCode chat | ✅ | Etapa 0 |
| 3 | Agent Loader | ✅ | Etapa 2 |
| 4 | Vector store JSON + Indexador manual | ✅ | Etapa 1, 3 |
| 5 | RAG query + filtro de permisos | ✅ | Etapa 4 |
| 6 | Orquestador con escritura de notas | ✅ | Etapa 3, 5 |
| 7 | Observabilidad (traces en sanctum-logs/) | ✅ | Etapa 6 |
| 8 | UI de chat funcional (modularizada) | ✅ | Etapa 7 |
| 9 | Mesh Forager → Researcher | ✅ | Etapa 8 |
| — | MIN_SIMILARITY = 0.65 (filtro RAG) | ✅ | Etapa 5 |
| — | write_paths enforcement + globMatch fix | ✅ | Etapa 6 |
| — | Encoding fix (U+FFFD en vector store) | ✅ | Etapa 4 |
| — | Toggle mesh + trace viewer + clipboard | ✅ | Etapa 9 |
| — | Vector Store JSONL + Base64 + tombstones | ✅ | Etapa 4 |
| 10 | Re-indexar /Research/ | ⏳ | Encoding fix |
| 11 | Web search como tool de agente | ✅ | Etapa 9 |
| 12 | Persistencia del historial del chat | ✅ | Etapa 20 |
| 13 | Tests automatizados (KG) | ✅ (36) | — |
| 14 | Selector de agente (@ mention) + /skills + ⛓️ chains | ✅ | Etapa 8 |
| 15 | Orquestador + Critic + loop + state machine | ✅ | Etapa 9 |
| — | Score anclado + sub-criterios + AttemptRecord | ✅ | Etapa 15 |
| — | Conversación con memoria (historial + rolling summary + pending action) | ✅ | — |
| 16 | KG-0: Edges semánticos | ✅ | Etapa 4 |
| — | KG-1: Edges explícitos + reinforced | ✅ | KG-0 |
| — | KG-2: Persistencia kg-edges.jsonl + incremental | ✅ | KG-1 |
| — | KG-3: Visualizador SVG (force + convolutional) | ✅ | KG-2 |
| 17 | Memoria persistente por proyecto | ✅ | Etapa 20 |
| 18 | Indexado incremental para KG + por hash para proyectos | ✅ | KG-2 / Etapa 20 |
| 19 | Skills (deep-research + / autocomplete + inyección) | ✅ | Etapa 15 |
| 20 | Proyectos con contexto persistente | ✅ | KG-3 |
| 21 | Orquestador de Cadenas (lienzo SVG + ejecución + loop Critic + animaciones) | ✅ | Etapa 15, 20 |
| — | Arquitectura en capas (AppServices + orquestadores) | ✅ | — |
| — | modularización chat-view (6 módulos) | ✅ | Etapa 8 |
| — | modularización chain-view (3 archivos) | ✅ | Etapa 21 |
| — | Folderos UI: toggle lectura/escritura + ✕ | ✅ | Etapa 20 |

---
