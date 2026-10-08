task_id: T-012
from_role: planner
to_role: worker
base_ref: 5c5d0d03bd599c0e512467b2c88328e3bc67c92d
worktree: orchestration/worktrees/T-012
branch: agent/T-012
seams: [S-rewrite-chat]
decisions: [DEC-0008]
resume_from: |
  Ponytail. No corras tests. Cita DEC-0008.
done_when:
- pendingAction vive en src/app/pending-turn.ts
- la intención de nota vive en src/app/write-turn.ts
- handleMessage sigue en chat-orchestrator.ts y los llama
- ChatOrchestrator se importa desde la misma ruta
stop_when:
- Hay que editar executeTurn o services.ts
- El comportamiento del turno cambia
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run: []
goldens_exposed: false
alarms: []
