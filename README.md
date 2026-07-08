# Sanctum-II

> Plugin de Obsidian: mesh de agentes de IA que investigan, evalúan y escriben notas sobre tu vault.

---

## Estado actual

Sanctum-II implementa un **orquestador con loop de investigación-crítica-regeneración**:

```
Usuario escribe una pregunta
  └─ 🔍 Forager — reformula el prompt con contexto RAG del vault
       └─ 📚 Researcher — produce investigación (hasta 3 intentos)
            └─ ⚖️ Critic — evalúa con 5 criterios (score threshold: 80/100)
                 ├─ Score ≥ 80 → ACCEPT → devuelve resultado
                 └─ Score < 80 → feedback → Researcher regenera
                                    └─ si ≥ 3 intentos → ESCALATE al usuario
```

### Funcionalidades incluidas

| Feature | Descripción |
|---|---|
| **Mesh Forager → Researcher → Critic** | Pipeline completo con loop de regeneración y threshold |
| **@mention autocomplete** | Dropdown al escribir `@` con agentes + notas del vault |
| **Indexación por carpeta** | Selector de subcarpeta de `/Research/` para indexado parcial y RAG scoped |
| **Creación de notas desde Mesh** | Decí "Crea una nota llamada X sobre Y" en modo Mesh → genera contenido + `#tags` → guarda `.md` en el vault |
| **RAG con filtro de permisos** | Los agentes respetan `read_paths`; la carpeta activa sobreescribe el filtro |
| **Traces completos** | Cada ejecución se guarda en `sanctum-logs/traces/` con historial, scores, tokens y feedback |
| **Modo chat directo** | Hablale a `@agente_base` o a cualquier agente vía `@id` |

### Agentes del sistema

| Agente | ID | Avatar | Rol |
|---|---|---|---|
| Agente Base | `agente_base` | 🤖 | Chat directo con RAG |
| Forager | `forager` | 🔍 | Reformula prompts con contexto del vault |
| Researcher | `researcher` | 📚 | Produce investigación detallada |
| Critic | `critic` | ⚖️ | Evalúa con 5 criterios (interno, no aparece en `@`) |

---

## Requisitos

- Obsidian v1.7+
- Una API key de [OpenCode](https://opencode.ai) (`OPENCODE_GO_API_KEY`)
- Al menos una API key de Gemini (`GEMINI_API_KEYS`) para embeddings

## Instalación

1. Copiar `main.js`, `manifest.json`, `styles.css` a `.obsidian/plugins/sanctum-ii/`
2. Copiar los agentes (`sanctum-agents/*.md`) a la raíz del vault
3. Configurar las API keys en Settings → Sanctum II
4. Recargar Obsidian (`Ctrl+R`)

## Uso rápido

1. Click en el icono 🤖 de la barra lateral para abrir el chat
2. Indexá `/Research/` con el botón 📚 Indexar
3. Escribí `@forager` para ver el autocomplete
4. Activá 🔀 Mesh y preguntá algo como _"Crea una nota llamada Quantum sobre computación cuántica"_

---

## Arquitectura

```
src/
├── main.ts                    Plugin lifecycle + thin delegation
├── agents/
│   ├── types.ts               AgentDefinition interface
│   ├── agent-loader.ts        Parse agent .md files
│   └── fallback.ts            Fallback agent
├── core/
│   ├── env-loader.ts          Environment variables
│   ├── note-writer.ts         Create/update/append vault notes
│   ├── commands.ts            Plugin commands
│   └── tests.ts               Test helpers
├── embeddings/
│   └── gemini-balancer.ts     Key rotation + embedding API
├── llm/
│   └── opencode-client.ts     OpenAI-compatible chat client
├── orchestrator/
│   ├── agent-turn.ts          RAG → render → chat pipeline
│   ├── mesh.ts                Forager→Researcher↔Critic loop
│   └── note-generator.ts      Write intent execution
├── rag/
│   ├── vector-store.ts        JSONL + Base64 + tombstones
│   └── indexer.ts             Chunk + embed + store
├── ui/
│   ├── chat-view.ts           Chat interface with autocomplete + mesh
│   └── settings-tab.ts        Settings panel
└── observability/
    └── tracer.ts              Trace recording
```

---

## Documentación

- [`docs/registro-arquitectura.md`](docs/registro-arquitectura.md) — Bitácora cronológica de todas las etapas y decisiones técnicas
