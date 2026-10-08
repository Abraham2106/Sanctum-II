# Agent roles

## planner

- **Entry:** `FEATURE-PREPARATION` o una pregunta de diseño escalada.
- **Does:** descomponer, escribir `DEC-*`, rellenar seams, definir la verificación sin pegar goldens en prompts de worker, actualizar `task-tree.json`.
- **Must not:** implementar, dejar un esqueleto que compile.
- **Stop:** pregunta abierta de producto; dos diseños posibles sin DEC.
- **Handoff:** worker (hoja `ready`) o hard-block.
- **Model:** Grok 4.6/4.7. Opus/Fable si el grafo de módulos es el cuello.

## worker

- **Entry:** task `ready`, worktree creado por `orchestrate.ps1 spawn`.
- **Does:** implementar exactamente los seams listados; verificación de su hoja; citar `DEC-*`.
- **Must not:** editar `docs/design/` salvo nits; leer `docs/graders/goldens/`; mergear a la rama principal; spawnear hermanos.
- **Stop:** decisión nueva; seam extra; archivo enorme; hecho de dominio ausente.
- **Handoff:** reviewer.
- **Model:** Composer 2.5.

## reviewer

- **Entry:** diff del worktree contra `base_ref`.
- **Does:** tres lentes — solo diff, solo contratos, ¿vio goldens?
- **Must not:** reescribir el feature; resolver split-brain en código.
- **Stop:** split-brain o DEC violada → planner, no worker.
- **Handoff:** judge.
- **Model:** distinto al worker.

## judge

- **Entry:** notas del reviewer.
- **Does:** `merge` / `reopen` / `kill`. Actualiza status. Puede aceptar una DEC nueva suya, no del worker.
- **Must not:** codear el fix.
- **Handoff:** la rama principal, o una hoja nueva.
