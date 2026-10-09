# Handoff contract

Todo spawn escribe este bloque en `orchestration/worktrees/<id>/HANDOFF.md`.

```yaml
task_id: T-XXX
from_role: planner
to_role: worker
base_ref: <git sha>
worktree: orchestration/worktrees/<id>
branch: agent/<id>
seams: []
decisions: []
resume_from: |
  qué ya está hecho en este checkout
done_when:
  - criterio observable
stop_when:
  - condición de abort
verification:
  planned: []
  run: []
goldens_exposed: false
alarms: []
```

Reglas:

- `to_role: worker` exige `goldens_exposed: false`.
- `alarms` no vacíos bloquean `done`.
- Si `seams` tiene más de un módulo y no hay un DEC de frontera, el planner parte la hoja.
- Reanudar no sobrescribe un `HANDOFF.md` que ya existe.
