# DEC-0001 — Separación planner / worker

- Status: `accepted`
- Decider: planner (bootstrap de swarm-build)
- Date: instalado con la metodología

## Decision

Los planners descomponen, deciden diseño y escriben `DEC-*`. No implementan. Los workers ejecutan una hoja del task tree en un git worktree y no abren nuevas decisiones de diseño.

## Why

Un solo agente o pierde el panorama o codea peor. Split-brain aparece cuando dos subárboles deciden el mismo concepto.

## Consequences

- Planner: Grok. No toca código de dominio.
- Worker: Composer 2.5, un `task-id`, seams listados.
- Toda pregunta de diseño en un worker es stop condition.

## Forbidden

Agentes peer coordinándose por un TODO.md con locks. Un chat que planea y codea el grafo de módulos a la vez.

## Cite in code

```text
// DEC-0001: this module does not own cross-cutting design
```
