task_id: T-011
from_role: planner
to_role: worker
base_ref: 5c5d0d03bd599c0e512467b2c88328e3bc67c92d
worktree: orchestration/worktrees/T-011
branch: agent/T-011
seams: [S-rewrite-main]
decisions: [DEC-0008]
resume_from: |
  Completado: cuerpos en src/plugin/{turns,session,diagnostics}.ts; main.ts delega en una línea.
done_when:
- sendChatMessage y runMesh viven en src/plugin/turns.ts
- setActiveProject y los hilos viven en src/plugin/session.ts
- indexResearch, tests de ajustes, runOrchestrate y createNoteWithAI viven en src/plugin/diagnostics.ts
- SanctumPlugin conserva esos métodos como una llamada
- onload sigue en main.ts
stop_when:
- Hay que cambiar una firma que la UI ya llama
- Hay que tocar un archivo fuera del seam
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run: ["Refactor DEC-0008 aplicado; tests no corridos por instrucción de hoja."]
goldens_exposed: false
alarms: []
