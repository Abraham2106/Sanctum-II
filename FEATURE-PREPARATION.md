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

## Sesión self-improve 2026-10-08

status: ready

- rationale: Automejora medible. Tres defectos ya reproducidos en el código actual, sin pregunta abierta.
- goal: El glob de permisos compara el path entero; un crítico sin score no se acepta; el MCP no tira la segunda clave Gemini.
- scope_in: DEC-0009, DEC-0010, DEC-0011.
- scope_out: Reescritura de UI, partir archivos, recursión del indexador, `@cursor/sdk`, EmbeddingGemma, `papepssss.md`, borrar el gobierno, `ChainStore.delete` (no tiene llamadores).
- constraints: Ponytail. Un seam por hoja. Sin dependencias. Suite completa la corre el planner después del merge.
- open_questions: ninguna
- assumption: La rama sale de `cursor/sanctum-refactor-9918` (`b4aa0f5`), que es el producto actual. `origin/main` no tiene el router ni la poda.

## Discord y Grok

status: ready

- rationale: El bot de Sanctum v1 no servía en este vault. El humano pidió esa pieza mejor y un gancho con Grok Bot.
- goal: Un proceso de Discord que conversa sobre una nota Markdown del canal y, si hay `XAI_API_KEY`, habla con Grok por el cable OpenAI. El vault sigue ofreciéndose a Grok Bot por el MCP stdio que ya existe.
- scope_in: DEC-0019.
- scope_out: Conector oficial de Grok Bot (no hay uno de Discord), MCP remoto, RAG por mensaje, cambios de UI, llamadas vivas a xAI o a Discord.
- constraints: Ponytail. `discord.js` solo en el proceso del bot. Suite completa después del merge de T-029.
- open_questions: ninguna
- risks: Sin `Message Content Intent` el gateway no entrega el texto. El token vive en el entorno del proceso, no en el vault.

## Grok Bot

status: ready

- rationale: El humano corrigió el gancho. Grok Bot es el sistema de xAI, no la API de chat.
- goal: El MCP de Sanctum responde en `POST /mcp` para pegarlo como conector custom.
- scope_in: DEC-0020.
- scope_out: OAuth, túnel, llamar a xAI, cambiar el gateway de Discord.
- constraints: Ponytail. Sin dependencia nueva. Bind en 127.0.0.1.
- open_questions: ninguna
- risks: Sin un túnel HTTPS, la nube de Grok Bot no llega a localhost.
