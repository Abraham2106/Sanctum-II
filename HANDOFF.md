task_id: T-013
from_role: planner
to_role: worker
base_ref: 5c5d0d03bd599c0e512467b2c88328e3bc67c92d
worktree: orchestration/worktrees/T-013
branch: agent/T-013
seams: [S-rewrite-projects]
decisions: [DEC-0008]
resume_from: |
  Ponytail. Mismo DOM y mismas clases CSS. No corras tests. Cita DEC-0008.
done_when:
- la lista vive en src/ui/projects/list.ts
- el centro vive en src/ui/projects/center.ts
- hilos, memoria y archivos viven en src/ui/projects/detail.ts
- ProjectsView y VIEW_TYPE_PROJECTS siguen exportándose desde projects-view.ts
- las clases CSS no cambian
stop_when:
- Hay que cambiar el DOM para poder partir
- Hay que tocar otra vista
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run: ["No correr vitest, tsc ni npm. (worker T-013)"]
goldens_exposed: false
alarms: []
notes: |
  Split projects-view.ts per DEC-0008:
  - src/ui/projects/list.ts — left rail, project create/rename/delete/star
  - src/ui/projects/center.ts — center pane hub + composer
  - src/ui/projects/detail.ts — center threads list, right panel (memory/files/drop), thread menus
  ProjectsViewHost exported from projects-view.ts for child modules.
