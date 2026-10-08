task_id: T-007
from_role: planner
to_role: worker
base_ref: 9a8054c6776e2ea63faba29b6cf14c8f2bab88d2
worktree: orchestration/worktrees/T-007
branch: agent/T-007
seams: [S-prune-const]
decisions: [DEC-0007]
resume_from: |
  Ponytail. Solo src/constants.ts. Rebusca cada nombre. Si aparece un uso, no lo borres. No reemplaces literales. No corras tests. Cita DEC-0007.
done_when:
- KG_DIR, MESH_THRESHOLDS, INDEX_DIR_BASE, MEMORY_DIR_BASE y THREADS_DIR_BASE ya no están si siguen sin llamadores
stop_when:
- Un símbolo de la lista tiene un uso
- Hay que tocar otro archivo
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run:
    - "rg KG_DIR|MESH_THRESHOLDS|INDEX_DIR_BASE|MEMORY_DIR_BASE|THREADS_DIR_BASE en worktree: solo docs/handoff; borrados de src/constants.ts (DEC-0007)"
goldens_exposed: false
alarms: []
