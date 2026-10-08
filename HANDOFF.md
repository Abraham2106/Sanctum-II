task_id: T-005
from_role: planner
to_role: worker
base_ref: 904a9ef47fe8958e249f9b45b5a384da5fd6d16d
worktree: orchestration/worktrees/T-005
branch: agent/T-005
seams: [S-chain]
decisions: [DEC-0006]
resume_from: |
  Ponytail. Dos archivos. No corras tests. Cita DEC-0006 en executeChain.
done_when:
- executeChain acepta pathFilter opcional y lo pasa como cuarto argumento de executeTurn
- La llamada de chat-orchestrator pasa snap.pathFilter
- undefined sigue significando el fallback de executeTurn
stop_when:
- Decisión sin DEC
- Editar TurnDeps o el cuerpo de executeTurn
- Seam extra
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run:
    - "No correr vitest, tsc ni npm. (planner planned; worker skipped per ponytail.)"
goldens_exposed: false
alarms: []
