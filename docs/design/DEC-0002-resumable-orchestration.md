# DEC-0002 — Orquestación reanudable

- Status: `accepted`
- Decider: planner (bootstrap de swarm-build)

## Decision

Normalizar listas del task tree aunque el JSON venga como escalar. Renderizar prompts y handoffs antes de efectos Git cuando sea posible. Si el worktree de una hoja ya existe, comprobar repo y rama y reutilizarlo solo si corresponde a esa hoja. No borrar ni recrear cambios. Completar el handoff faltante sin sobrescribir evidencia previa.

## Why

Un spawn que falla a medias deja un worktree válido. Repetir `git worktree add` o regenerar `HANDOFF.md` destruye la evidencia.

## Consequences

El seam S-orch es dueño de `orchestration/`. El planner completa el handoff a mano si el bootstrap del worktree quedó a medias, y delega dentro de ese checkout.

## Forbidden

Borrar `orchestration/worktrees/<id>` para “empezar limpio” si hay cambios sin commitear o un `HANDOFF.md` con `verification.run`.

## Cite in code

```text
// DEC-0002: resume matching worktree; do not clobber HANDOFF evidence
```
