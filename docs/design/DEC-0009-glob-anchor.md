# DEC-0009 — globMatch ancla el patrón entero

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

`globMatch` compara el path completo. `**` es cualquier resto de ruta (incluye `/`). `*` es un solo segmento (`[^/]*`). Un patrón que empieza por `/` se sigue recortando. `**` o `""` solos siguen coincidiendo con todo. No se normalizan `..` ni se añade soporte de `?`.

## Why

El regex actual no tiene `$`, así que `Research/*.md` acepta `Research/nota.md.exe` y `Research/nota.md/secret`. Además `.` se escapa después de expandir `**`, y `**` queda como `\.*` (puntos literales). `Docs/**/*.md` no coincide con `Docs/sub/a.md`. Los permisos de lectura, el filtro RAG y el MCP usan esta función.

## Consequences

La hoja solo edita `src/utils.ts` (`globMatch`) y añade `src/utils.glob.test.ts`. Los tests ya existentes de `src/permissions.test.ts` tienen que seguir pasando sin editar ese archivo.

## Forbidden

Tocar `pathMatchesAny` salvo que el cambio de `globMatch` lo arrastre. Rechazar `..` aquí. Partir `permissions.test.ts`. Dependencias nuevas.

## Cite in code

```text
// DEC-0009: el glob compara el path completo; ** cruza segmentos
```
