task_id: T-010
from_role: planner
to_role: worker
base_ref: 9a8054c6776e2ea63faba29b6cf14c8f2bab88d2
worktree: orchestration/worktrees/T-010
branch: agent/T-010
seams: [S-prune-scan]
decisions: [DEC-0007]
resume_from: |
  Ponytail. Directorios: src/orchestrator, y los archivos src/core/commands.ts, note-writer.ts, vault-fs.ts, vault-adapter.ts. Borra solo funciones, constantes o imports sin ningún uso en el worktree. Si no hay nada, no inventes un diff: dilo en HANDOFF y no hagas commit de código. No edites tests.ts ni env-loader.ts. No corras tests.
done_when:
- Cada borrado de este seam tiene cero referencias fuera de su definición, anotado en el handoff
stop_when:
- La duda no se resuelve con una búsqueda
- El cambio altera una firma que alguien llama
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run:
    - "DEC-0007: borrados NoteWriter.append, NoteWriter.replace (rg 'noteWriter\\.(append|replace)' en worktree → solo docs/mcp dist; rg 'async append\\(' en src/core/note-writer.ts → sin coincidencias)."
    - "DEC-0007: mesh.ts — quitados re-exports sin consumidores y type imports CriteriaScore, HistoryEntry, OrchestratorAction, OrchestratorDecision (rg 'from \\\".*orchestrator/mesh\\\"' → MeshResultFull, runMeshWithCritic, parseCriticJSON vía permissions.test)."
goldens_exposed: false
alarms: []
