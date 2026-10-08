# FEATURE-PREPARATION

status: ready
feature_id: SANCTUM-REFACTOR
feature_title: Refactor por dueño, router de chat y contrato de embedding

Ready exige REQ-0001 sin `UNANSWERED` y sin `TBD` críticos. Hasta entonces no hay código de dominio.

- rationale: El humano pidió un refactor completo con ponytail, tests solo al final, un router de IA (Cursor / OpenAI / Claude) y, a futuro, el embedding abierto de Gemini.
- goal: Un dueño por concepto duplicado, dos cables de chat, y el contrato de embedding listo para EmbeddingGemma 2 sin cambiar los vectores de hoy.
- scope_in: DEC-0003, DEC-0004, DEC-0005, DEC-0006.
- scope_out: Reescritura de UI, recursión del indexador, `@cursor/sdk` en el plugin, descarga de EmbeddingGemma, README, `papepssss.md`, borrar `chain-inspector.ts` (ya es un comentario de una línea).
- constraints: Planner no implementa; worker aislado; un seam por hoja. Ponytail en cada hoja. Suite solo en T-006.
- open_questions: ninguna
- risks: Un merge con dos writers del mismo archivo. Los seams de esta ola no comparten archivos.
- security_privacy_notes: Las claves siguen en settings y env. No se escriben en el repo. El cable Anthropic usa `x-api-key` y no se loguea.
- non_functional_requirements: El plugin sigue usando `requestUrl`. El MCP sigue usando `fetch`. Sin dependencias nuevas.
- verification_strategy: Hojas T-001..T-005 no corren la suite. T-006 corre `npm run typecheck` y `npm test`.
