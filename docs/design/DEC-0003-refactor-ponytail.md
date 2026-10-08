# DEC-0003 — Refactor por dueño, no por reescritura

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

Esta ola conserva el comportamiento del vault, del chat y del MCP, salvo los bugs nombrados en DEC-0005 y DEC-0006. Cada concepto tiene un solo módulo dueño. El worker borra el duplicado y apunta al dueño. No hay capas nuevas.

## Why

El mapa del repo mostró los mismos números y las mismas rutas escritos en varios archivos. Dos dueños del mismo concepto divergen. Una reescritura del plugin no está pedida.

## Consequences

Los workers citan `DEC-0003` cuando borran un literal duplicado. Los tests de la ola se escriben junto a la rama nueva y se ejecutan solo en T-006.

## Forbidden

Reescribir UI, recursión del indexador, renombrar campos persistidos, dependencias nuevas, y correr `npm test` dentro de una hoja que no sea T-006.

## Cite in code

```text
// DEC-0003: un solo dueño para este valor
```
