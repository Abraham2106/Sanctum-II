# DEC-0006 — Dos bugs ya visibles, sin rediseño

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

1. `indexProject` parte el Markdown con `project.rag.chunk_words`. Si el valor no es un entero mayor que 0, usa `DEFAULT_PROJECT_RAG.chunk_words` (400). No se añaden carpetas hijas al recorrido.
2. `executeChain` reenvía a `executeTurn` el mismo `pathFilter` que el chat ya pasa en el cuarto argumento (la carpeta activa, o `undefined`). `undefined` conserva el fallback actual de `executeTurn` (`project.read_paths`).

## Why

El campo `chunk_words` ya se guarda por proyecto y el indexador lo ignora. El chat pasa `snap.pathFilter` a `executeTurn`; la cadena no, así que con una carpeta activa busca en todo el proyecto.

## Consequences

La hoja del índice solo toca `src/projects/indexer.ts` y su test. La hoja de la cadena solo toca `src/chains/executor.ts` y la llamada en `src/app/chat-orchestrator.ts`.

## Forbidden

Recorrer subcarpetas. Cambiar el umbral de similitud. Meter `pathFilter` dentro de `TurnDeps`.

## Cite in code

```text
// DEC-0006: el tamaño de chunk y el filtro de carpeta tienen un solo camino
```
