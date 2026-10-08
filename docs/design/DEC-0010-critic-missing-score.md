# DEC-0010 — score ausente del crítico vale 0

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

Si `parseCriticJSON` obtiene un objeto y `total_score` no es un número finito, el score es 0. Un número presente se conserva, incluido 80. El fallo de parseo sigue devolviendo score 0 y verdict `reject`. `threshold` ausente sigue en 80.

## Why

El comentario del parser dice que un fallo no debe aceptar en silencio con 80. La rama de éxito hace `total_score ?? 80`. El mesh acepta con score ≥ 80, así que un JSON sin score se acepta.

## Consequences

La hoja edita `src/shared/mesh/parse.ts` y crea `src/shared/mesh/parse.test.ts`. No edita `src/permissions.test.ts` ni `src/ui/chain-view.ts`.

## Forbidden

Cambiar el umbral 80/40 del mesh. Reinterpretar `verdict`. Tocar la vista de cadenas.

## Cite in code

```text
// DEC-0010: sin total_score numérico el crítico no aprueba
```
