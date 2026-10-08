task_id: T-015
from_role: planner
to_role: worker
base_ref: 5c5d0d03bd599c0e512467b2c88328e3bc67c92d
worktree: orchestration/worktrees/T-015
branch: agent/T-015
seams: [S-rewrite-kg]
decisions: [DEC-0008]
resume_from: |
  Ponytail. No corras tests. Cita DEC-0008.
done_when:
- layout, render y zoom viven en src/ui/kg-scene.ts
- el inspector vive en src/ui/kg-inspector.ts
- KgView y VIEW_TYPE_KG siguen en kg-view.ts
stop_when:
- Hay que editar src/kg
- Cambia el DOM o las clases CSS
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run: []
goldens_exposed: false
alarms: []
