# Module seams

Un worker toca un seam. Ninguno edita código de otro. El planner añade filas antes de abrir la hoja.

| id | path | owns | must not own | status |
|---|---|---|---|---|
| S-orch | orchestration/ y docs de gobierno | tareas, evidencia, handoffs | código de dominio | accepted |
| S-llm | `src/llm/**`, `src/constants.ts`, `src/core/env-loader.ts`, `src/main.ts` (solo construcción del cliente), `src/ui/settings-tab.ts`, `.env.example` (claves LLM), `mcp-server/src/llm/opencode-chat.ts` | cable de chat y ajustes del proveedor | orquestador, tools MCP, `mcp-server/index.ts`, embeddings, bloque Discord/XAI de `.env.example` | accepted |
| S-embed | `src/embeddings/**`, `mcp-server/src/embeddings/gemini-embed.ts` | contrato y cuerpos de embedding | indexador, query-vault, `mcp-server/index.ts` | accepted |
| S-defaults | `src/observability/tracer.ts`, `mcp-server/src/observability/trace-writer.ts`, `mcp-server/src/tools/query-vault.ts`, `src/projects/store.ts`, `src/projects/types.ts`, `src/skills/authoring/mesh.ts`, `src/core/tests.ts` | literales duplicados de RAG, chunk default y trazas | `src/constants.ts`, `src/llm/**`, indexador | accepted |
| S-index | `src/projects/indexer.ts`, `src/projects/indexer.test.ts` | tamaño de chunk del proyecto | el default en `types.ts` | accepted |
| S-chain | `src/chains/executor.ts`, `src/app/chat-orchestrator.ts` | reenvío de `pathFilter` | `executeTurn` y `TurnDeps` | accepted |
| S-prune-const | `src/constants.ts` | exports sin llamadores de esa lista | el resto de settings y `RAG_DEFAULTS` | accepted |
| S-prune-ui | `src/ui/chain-inspector.ts` | el archivo huérfano | el resto de `src/ui` | accepted |
| S-prune-symbols | `src/shared/mesh/core.ts`, `src/kg/types.ts`, `src/agents/authoring/types.ts`, `src/chains/executor.ts` | los cuatro símbolos de DEC-0007 | `executeTurn`, `MESH_DEFAULTS`, `KgOptions` | accepted |
| S-prune-scan | `src/orchestrator/**`, `src/core/commands.ts`, `src/core/note-writer.ts`, `src/core/vault-fs.ts`, `src/core/vault-adapter.ts` | símbolos de esos archivos con cero usos | `tests.ts`, `env-loader.ts`, firmas vivas | accepted |
| S-rewrite-main | `src/main.ts`, `src/plugin/**` | turno, sesión y diagnósticos sacados de main | UI, orquestador, llm | accepted |
| S-rewrite-chat | `src/app/chat-orchestrator.ts`, `src/app/pending-turn.ts`, `src/app/write-turn.ts` | confirmación y escritura de notas | `executeTurn`, `services.ts` | accepted |
| S-rewrite-projects | `src/ui/projects-view.ts`, `src/ui/projects/**` | lista, centro y detalle | otras vistas | accepted |
| S-rewrite-chain | `src/ui/chain-view.ts`, `src/ui/chain-canvas.ts` | lienzo y modal de resultado | `chain-types.ts`, `chains/executor.ts` | accepted |
| S-rewrite-kg | `src/ui/kg-view.ts`, `src/ui/kg-scene.ts`, `src/ui/kg-inspector.ts` | escena e inspector | `src/kg/**` | accepted |
| S-verify | suite al cierre | `npm run typecheck` y `npm test` una vez | features nuevas | accepted |
| S-glob | `src/utils.ts` (`globMatch`), `src/utils.glob.test.ts` | ancla y `**` de DEC-0009 | `pathMatchesAny`, `permissions.test.ts`, el resto de utils | accepted |
| S-critic-parse | `src/shared/mesh/parse.ts`, `src/shared/mesh/parse.test.ts` | score ausente de DEC-0010 | umbrales del mesh, `chain-view.ts`, `permissions.test.ts` | accepted |
| S-mcp-keys | `mcp-server/index.ts` (claves Gemini), `mcp-server/src/embeddings/gemini-embed.ts`, `mcp-server/src/embeddings/gemini-embed.test.ts` | rotación de claves de DEC-0011 | `query-vault.ts`, balancer del plugin, `embed-contract.ts`, el arranque HTTP | accepted |
| S-index-scope | `src/projects/indexer.ts`, `src/projects/indexer.test.ts` | el sentido de `isAllowedPath` de DEC-0013 | `chunk_words`, recursión, `main.ts` | accepted |
| S-chain-critic | `src/chains/critic-decision.ts`, `src/chains/critic-decision.test.ts`, `src/ui/chain-view.ts` | la decisión del bucle de DEC-0014 | modal, DOM, CSS, umbral, intentos | accepted |
| S-cosine | `src/rag/vector-store.ts` (`cosineSimilarity`), `src/rag/cosine.test.ts` | largos distintos de DEC-0015 | `search` ranking, umbral, formato jsonl, `permissions.test.ts` | accepted |
| S-note-ref | `src/orchestrator/note-resolver.ts`, `src/orchestrator/note-resolver.test.ts` | el match de título de DEC-0016 | RAG 0.05, `chat-orchestrator.ts`, `permissions.test.ts` | accepted |
| S-modify-name | `src/app/chat-orchestrator.ts` (solo `modify_note`), `src/note-flow.test.ts` | el uso de `noteName` de DEC-0017 | `create_note`, el resolver, otras vistas | accepted |
| S-detach-file | `src/projects/detach-file.ts`, `src/projects/detach-file.test.ts`, el onclick de quitar en `src/ui/projects-view.ts` | DEC-0018 | dropzone, CSS, borrar el archivo del vault | accepted |
| S-discord-log | `src/discord/channel-log.ts`, `src/discord/channel-log.test.ts` | nota de canal, merge, cuándo contestar | red, discord.js, el proceso del bot | accepted |
| S-discord-api | `src/discord/discord-api.ts`, `src/discord/discord-api.test.ts` | destino Grok/OpenCode y cuerpos REST, sin red | `chat-wire.ts`, gateway, `.env.example` | accepted |
| S-discord-agent | `sanctum-agents/discord.md`, el bloque Discord/XAI al final de `.env.example` | el prompt del canal y las variables | claves LLM ya existentes, código | accepted |
| S-discord-bot | `discord-bot/index.ts`, `package.json` (script `discord` y dependencia `discord.js`), la línea `discord-bot` de `tsconfig.json` | gateway, allowlist, un fetch de historia, respuesta | esbuild, `src/main.ts`, `mcp-server/index.ts`, `chat-wire.ts` | accepted |
| S-mcp-http | `mcp-server/src/mcp/http.ts`, `mcp-server/src/mcp/http.test.ts`, `handleMessage` y la versión de `initialize` en `mcp-server/src/mcp/server.ts`, el arranque `SANCTUM_MCP_HTTP` en `mcp-server/index.ts`, el script `mcp:http` de `package.json`, las líneas `SANCTUM_MCP_*` de `.env.example` | DEC-0020 | claves Gemini, Discord, esbuild, OAuth, un túnel, el texto `instructions` | accepted |
| S-mcp-guide | `mcp-server/src/mcp/server.ts` (`instructions` y el paso de `annotations`), `mcp-server/src/mcp/types.ts`, `mcp-server/src/mcp/server.test.ts`, el objeto `annotations` de `list-agents.ts`, `get-note.ts` y `query-vault.ts` | DEC-0021 en el anuncio | handlers de esas tools, `index.ts`, HTTP | accepted |
| S-mcp-notes | `mcp-server/src/tools/list-notes.ts`, `mcp-server/src/tools/list-notes.test.ts`, el `registerTool` de esa tool en `mcp-server/index.ts` | DEC-0021 al listar | el resto de `index.ts`, el índice, recursión | accepted |
| S-mcp-context | `mcp-server/src/tools/tool-context.ts`, `mcp-server/src/tools/tool-context.test.ts`, el argumento `context` y `annotations` de `invoke-agent.ts` y `run-mesh.ts` | DEC-0021 en el contexto | el bucle del mesh, embeddings, `server.ts` | accepted |
| S-mcp-limit | el tope de cuerpo en `mcp-server/src/mcp/http.ts` y el caso 413 de `mcp-server/src/mcp/http.test.ts` | DEC-0021 | el resto del HTTP, Discord | accepted |

## SANCTUM-RUNTIME-V2 (DEC-0022)

Un seam agrupa una frontera explícita; las dependencias serializan sus adaptadores.

| id | owns | status |
|---|---|---|
| S-runtime-035 | src/shared/agents/frontmatter.ts, src/agents/agent-loader.ts, mcp-server/src/tools/list-agents.ts | accepted |
| S-runtime-036 | src/runtime/permissions.ts, src/runtime/retrieval.ts, src/orchestrator/agent-turn.ts | accepted |
| S-runtime-037 | mcp-server/src/mcp/http.ts, mcp-server/src/mcp/http.test.ts | accepted |
| S-runtime-038 | src/core/resource-queue.ts, src/projects/store.ts, src/rag/vector-store.ts, src/kg/kg-store.ts | accepted |
| S-runtime-039 | src/runtime/dag.ts, src/runtime/mesh.ts, src/chains/executor.ts, src/orchestrator/mesh.ts, src/orchestrator/mesh-types.ts, src/shared/mesh/types.ts, mcp-server/src/tools/run-mesh.ts | accepted |
| S-runtime-040 | src/projects/index-generations.ts, src/projects/indexer.ts, src/projects/indexer.test.ts, src/embeddings/gemini-balancer.ts, mcp-server/src/embeddings/gemini-embed.ts | accepted |
| S-runtime-041 | mcp-server/index.ts, mcp-server/src/tools/query-vault.ts, mcp-server/src/tools/get-note.ts, mcp-server/src/tools/list-notes.ts, mcp-server/src/mcp/permission-resolver.ts, src/app/project-reader.ts | accepted |
| S-runtime-042 | src/main.ts, src/plugin/**, src/app/services.ts, src/app/chat-orchestrator.ts, src/app/pending-turn.ts, src/app/write-turn.ts | accepted |
| S-runtime-043 | src/ui/chain-view.ts, src/ui/chain-canvas.ts, src/ui/projects-view.ts, src/ui/projects/**, src/ui/kg-view.ts, src/ui/kg-scene.ts, src/ui/kg-inspector.ts, src/ui/chat-view.ts, src/ui/chat-types.ts | accepted |
| S-runtime-044 | package.json, .github/workflows/ci.yml, mcp-server/test/**, vitest.config.ts, scripts/**, README.md, mcp-server/README.md, .env.example, docs/audits/2026-10-08/reproduce.test.ts, docs/registro-arquitectura.md, docs/arquitectura-uml.md | accepted |
| S-runtime-045 | src/runtime/providers.ts, src/llm/opencode-client.ts, src/llm/chat-wire.ts, mcp-server/src/llm/opencode-chat.ts, discord-bot/index.ts | accepted |

| S-runtime-046 | src/skills/authoring/mesh.ts, src/orchestrator/note-resolver.ts, src/orchestrator/note-generator.ts, src/core/note-writer.ts and owned tests | accepted |

T036 additionally owns runtime/turn.ts and ports.ts; T043 owns chat-right/composer index-state to present all statuses. T042 consumes scoped note resolver. No overlapping writers.
