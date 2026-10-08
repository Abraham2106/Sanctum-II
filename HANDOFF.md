task_id: T-004
from_role: planner
to_role: worker
base_ref: 904a9ef47fe8958e249f9b45b5a384da5fd6d16d
worktree: orchestration/worktrees/T-004
branch: agent/T-004
seams: [S-index]
decisions: [DEC-0006]
resume_from: |
  Ponytail. No corras vitest. El test queda escrito para T-006. Cita DEC-0006.
done_when:
- chunkText usa project.rag.chunk_words
- Un entero menor que 1 cae a DEFAULT_PROJECT_RAG.chunk_words
- indexer.test.ts cubre un tamaño distinto de 400 y el fallback
stop_when:
- Decisión sin DEC
- Recorrer subcarpetas
- Editar projects/types.ts
verification:
  planned: ["No correr vitest, tsc ni npm. Dejar el test nuevo en indexer.test.ts."]
  run: []
goldens_exposed: false
alarms: []
