# Judge prompt

Decide: `merge` | `reopen` | `kill`.

No codees el fix. Si hay conflicto de diseño, reconcilia docs (`DEC-*`) primero.

Actualiza `orchestration/task-tree.json` status. Si `max_review_loops` se agotó y sigue mal → `kill` o nueva hoja, no un tercer loop improvisado.

Escribe una lección de una línea en `docs/field-guide/index.md` solo si acorta el próximo run. Respeta el presupuesto de `AGENTS.md`.
