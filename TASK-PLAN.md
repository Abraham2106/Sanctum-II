# TASK-PLAN

feature_id: SANCTUM-REFACTOR
status: ready
scope: Refactor por dueño. Router de chat de dos cables. Contrato de embedding. Dos bugs nombrados. Suite al final.

## Gobierno

JSON canónico: `orchestration/task-tree.json`. Una hoja, un seam y un worktree por worker Composer 2.5. Planner y reviewer no implementan dominio. Máximo dos reviews. No afirmar integración con mocks o skips.

Rollback: revertir solo commits de la hoja; conservar worktrees, evidencia y cambios previos.

## Registro

- T-000: Ingerir requisitos — done (planner).
- T-001: Router de chat OpenAI-compatible y Anthropic — ready (S-llm, DEC-0004).
- T-002: Contrato de embedding Gemini, hueco para EmbeddingGemma 2 — ready (S-embed, DEC-0005).
- T-003: Un solo dueño de los literales RAG y de trazas — ready (S-defaults, DEC-0003).
- T-004: El indexador usa `chunk_words` — ready (S-index, DEC-0006).
- T-005: La cadena reenvía `pathFilter` — ready (S-chain, DEC-0006).
- T-001..T-005: hechas y mergeadas.
- T-007: Borrar exports muertos de `constants.ts` — ready (S-prune-const, DEC-0007).
- T-008: Borrar `chain-inspector.ts` — ready (S-prune-ui, DEC-0007).
- T-009: Borrar cuatro símbolos sin uso — ready (S-prune-symbols, DEC-0007).
- T-010: Barrido de orquestador y core — ready (S-prune-scan, DEC-0007).
- T-006: typecheck y vitest en verde sobre la poda ya mergeada.
- T-011..T-015: reescritura por trabajo de los cinco archivos de más de 400 líneas (DEC-0008).
- T-016: los cuatro símbolos de DEC-0007 que no llegaron a borrarse.

Paralelo ahora: T-011, T-012, T-013, T-014, T-015, T-016. No comparten archivos. La suite corre después del merge.

## Self-improve 2026-10-08

- T-017: anclar `globMatch` (S-glob, DEC-0009) — ready.
- T-018: score ausente del crítico = 0 (S-critic-parse, DEC-0010) — ready.
- T-019: el MCP recorre las claves Gemini (S-mcp-keys, DEC-0011) — ready.

Las tres no comparten archivos. La suite completa corre en la rama después del merge.

## Discord (DEC-0019)

- T-026: nota de canal (S-discord-log) — done.
- T-027: destino Grok y REST de Discord (S-discord-api) — done.
- T-028: agente y variables (S-discord-agent) — done.
- T-029: proceso del bot (S-discord-bot) — done.

## Grok Bot (DEC-0020)

- T-030: MCP por HTTP para el conector de Grok Bot (S-mcp-http) — done.

## MCP (DEC-0021)

- T-031: instructions y annotations (S-mcp-guide) — ready.
- T-032: listar notas (S-mcp-notes) — ready.
- T-033: context en invocar y mesh (S-mcp-context) — ready.
- T-034: corte de 1 MiB (S-mcp-limit) — ready.

Las cuatro no comparten archivos. T-034 solo añade el tope en el HTTP que T-030 ya mergeó.
