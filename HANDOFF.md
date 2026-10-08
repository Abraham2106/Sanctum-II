task_id: T-003
from_role: planner
to_role: worker
base_ref: 904a9ef47fe8958e249f9b45b5a384da5fd6d16d
worktree: orchestration/worktrees/T-003
branch: agent/T-003
seams: [S-defaults]
decisions: [DEC-0003]
resume_from: |
  Ponytail. Importa lo que ya existe. No muevas ni borres exports de constants.ts (otra hoja es dueña de ese archivo). No corras tests. Cita DEC-0003 en el import que sustituye un literal.
done_when:
- tracer.ts y trace-writer.ts usan TRACES_DIR de src/constants.ts
- query-vault, mesh de skills y core/tests usan RAG_DEFAULTS.MIN_SIMILARITY
- projects/store.ts usa DEFAULT_PROJECT_RAG para 400 y 0.65 en vez de literales propios
- MESH_DEFAULTS en shared/mesh sigue siendo el dueño de los umbrales del mesh
stop_when:
- Decisión sin DEC
- Editar src/constants.ts o src/llm
- Editar indexer.ts
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run:
    - "Diff review: tracer.ts y trace-writer.ts importan TRACES_DIR desde constants; query-vault.ts, mesh.ts, tests.ts usan RAG_DEFAULTS.MIN_SIMILARITY; store.ts usa DEFAULT_PROJECT_RAG.chunk_words y min_similarity. Sin vitest/tsc/npm."
goldens_exposed: false
alarms: []
