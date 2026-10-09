# DEC-0012 — un patrón que termina en / es la carpeta

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes: el ancla final obligatoria de DEC-0009, solo cuando el patrón termina en `/`

## Decision

Si el patrón, ya sin la barra inicial, termina en `/`, coincide con esa carpeta y con todo lo que cuelga de ella: el regex lleva `^` y la barra final, y no lleva `$`. No coincide con un hermano que solo comparta el prefijo de texto (`/Research/` no coincide con `Research-extra/a.md`). El resto de los patrones sigue anclado de punta a punta como dice DEC-0009.

## Why

Los proyectos nacen con `read_paths` `/Research/` y `/Projects/{id}/`, y `canWriteToPath` ya exige que `/Projects/test/` cubra `Projects/test/nota.md`. Anclar eso con `$` deja el vault por defecto sin permiso de escritura. La suite lo marcó en `permissions.test.ts`.

## Consequences

La misma hoja S-glob añade el caso y los tests. No se toca otro archivo.

## Forbidden

Volver a un prefijo sin barra final. Tratar `*` o `**` como carpeta. Normalizar `..`.

## Cite in code

```text
// DEC-0012: la barra final es la carpeta, no un path exacto
```
