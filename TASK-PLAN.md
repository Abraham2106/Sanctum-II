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
- T-006: Typecheck y vitest una vez — espera a T-001..T-005 (S-verify).

Paralelo ahora: T-001, T-002, T-003, T-004, T-005. No comparten archivos.
