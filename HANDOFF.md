task_id: T-016
from_role: worker
to_role: reviewer
base_ref: 5c5d0d03bd599c0e512467b2c88328e3bc67c92d
worktree: orchestration/worktrees/T-016
branch: agent/T-016
seams: [S-prune-symbols]
decisions: [DEC-0007]
resume_from: |
  Poda DEC-0007 aplicada en core.ts, kg/types.ts, agents/authoring/types.ts, chains/executor.ts. Import huérfano VaultAdapter quitado tras borrar AgentAuthoringOptions. MESH_DEFAULTS quitado de core.ts con shouldRegenerate.
done_when:
- shouldRegenerate no está
- DEFAULT_KG_OPTIONS no está
- AgentAuthoringOptions no está
- previousOutput no está
stop_when:
- Un símbolo tiene un llamador
- Hace falta borrar AgentAuthoringLLM todavía usado
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run: []
goldens_exposed: false
alarms: []
