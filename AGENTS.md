# AGENTS.md — Field Guide (inyectado a todo agente)

Memoria institucional del repo. Presupuesto duro: **este archivo ≤ 80 líneas**. Sorpresas nuevas van a `docs/field-guide/index.md`.

## Roles (no mezclar)

| Rol | Modelo preferido | Puede escribir código | Puede decidir diseño |
|---|---|---|---|
| planner | Grok 4.6/4.7 (Opus/Fable si el diseño es el cuello) | no | sí, y debe dejar `DEC-*` |
| worker | Composer 2.5 | sí, solo su hoja | no; pregunta de diseño → stop |
| reviewer | modelo distinto al worker | no (salvo nits triviales) | no; reporta split-brain |
| judge | mismo que planner o reviewer | no | sí: continuar / reabrir / merge |

Un planner que implementa está mal. Un worker que rediseña el grafo de módulos está mal.

Autonomía: no preguntar al humano a mitad de run. Hecho faltante → `orchestration/runs/BLOCKED.md` + notify hard-block. Aviso solo en `done` / `killed` / hard-block. Detalle: `orchestration/autonomy.md`.

## Antes de implementar

1. `FEATURE-PREPARATION.md` tiene que estar `ready`. Si hay `TBD` críticos o `UNANSWERED`, el estado es `INVALID_INPUT`.
2. Toda hoja vive en `orchestration/task-tree.json` con `status: ready`.
3. Toda decisión de diseño tiene un id `DEC-XXXX` en `docs/design/DECISIONS.md`. El código que dependa de ella cita el id.
4. Un worker corre **en su worktree**, nunca en la rama principal. Spawn: `powershell -File orchestration/orchestrate.ps1 spawn <task-id>`.

## Límites de este repo

- Dominio declarado: **Sanctum II, plugin Obsidian local-first y servidor MCP sobre el vault**.
- Prohibido inventar protocolo, APIs o módulos de relleno que el requisito no pida.
- Prohibido mock silencioso de una dependencia real. Si hace falta un doble, es una `alarm` en la hoja con ruta de reemplazo.
- Si hay grader, los goldens viven en `docs/graders/goldens/` y **no se pegan en el prompt del worker**.

## Stop conditions (worker)

Parar y devolver al planner si: aparece una decisión sin `DEC-*`; dos módulos reclaman el mismo concepto; un archivo pasa de ~400 líneas sin dueño de split; la hoja toca más de un seam en `docs/contracts/module-seams.md`; falta un hecho del dominio declarado.

## Dónde escribir

- Diseño: `docs/design/`
- Contratos de agente y de módulo: `docs/contracts/`
- Lecciones de run: `docs/field-guide/index.md`
- Tareas: `orchestration/task-tree.json` (canónico) y `TASK-PLAN.md` (gobierno)
