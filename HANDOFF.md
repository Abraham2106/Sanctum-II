task_id: T-014
from_role: planner
to_role: worker
base_ref: 5c5d0d03bd599c0e512467b2c88328e3bc67c92d
worktree: orchestration/worktrees/T-014
branch: agent/T-014
seams: [S-rewrite-chain]
decisions: [DEC-0008]
resume_from: |
  Ponytail. No corras tests. Cita DEC-0008.
done_when:
- nodos, aristas, zoom y arrastre viven en src/ui/chain-canvas.ts
- el modal de resultado, si está en chain-view.ts, vive en ese archivo de lienzo o en src/ui/chain-result.ts
- ChainView sigue exportándose desde chain-view.ts
stop_when:
- Hay que editar chain-types.ts o chains/executor.ts
- Cambia el DOM
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run: ["No correr vitest, tsc ni npm. (worker T-014)"]
goldens_exposed: false
alarms: []
worker_notes: |
  - Añadidos src/ui/chain-canvas.ts (ChainCanvas: nodos, aristas, zoom, arrastre, mount del lienzo) y src/ui/chain-result.ts (ResultModal).
  - chain-view.ts conserva ChainView, VIEW_TYPE_CHAINS, ejecución de cadena e I/O; delega lienzo a ChainCanvas.
  - DEC-0008 citado en archivos nuevos. Sin cambios a chain-types.ts ni chains/executor.ts.
