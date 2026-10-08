# Orchestration

El árbol canónico es `task-tree.json` (schema en `docs/contracts/task-tree.schema.json`).

```powershell
powershell -File ./orchestration/orchestrate.ps1 preflight
powershell -File ./orchestration/orchestrate.ps1 run
powershell -File ./orchestration/orchestrate.ps1 notify done

powershell -File ./orchestration/orchestrate.ps1 status
powershell -File ./orchestration/orchestrate.ps1 prompt T-000
powershell -File ./orchestration/orchestrate.ps1 spawn T-000
powershell -File ./orchestration/orchestrate.ps1 review T-000
powershell -File ./orchestration/orchestrate.ps1 finish T-000 review
```

Worktrees: `orchestration/worktrees/<id>/` (gitignored). Cada spawn escribe `HANDOFF.md` + `PROMPT.md`.

El script no llama a Cursor. El planner pega `PROMPT.md` en un subagente con el modelo del rol, acotado a ese worktree.

Tests: `powershell -File ./orchestration/tests/Run-OrchestrationTests.ps1`
