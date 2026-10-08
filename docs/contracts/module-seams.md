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
| S-verify | suite al cierre | `npm run typecheck` y `npm test` una vez | features nuevas | accepted |
