# Module seams

Un worker toca un seam. Ninguno edita código de otro. El planner añade filas antes de abrir la hoja.

| id | path | owns | must not own | status |
|---|---|---|---|---|
| S-orch | orchestration/ y docs de gobierno | tareas, evidencia, handoffs | código de dominio | accepted |
| S-llm | `src/llm/**`, `src/constants.ts`, `src/core/env-loader.ts`, `src/main.ts` (solo construcción del cliente), `src/ui/settings-tab.ts`, `.env.example`, `mcp-server/src/llm/opencode-chat.ts` | cable de chat y ajustes del proveedor | orquestador, tools MCP, `mcp-server/index.ts`, embeddings | accepted |
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
