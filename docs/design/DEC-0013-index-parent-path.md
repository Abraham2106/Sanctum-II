# DEC-0013 — un índice parcial no sube a la carpeta padre

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

`isAllowedPath` acepta la carpeta pedida solo si es un `read_path` o está dentro de uno. Un padre de un `read_path` queda fuera y el indexador devuelve el error que ya existe.

## Why

La comprobación también daba por válida la dirección inversa: pedir `Vault` con `read_paths` `Vault/Research` pasaba, y el listado indexaba todo `Vault`. El mensaje de error ya dice que la carpeta pedida está fuera de los `read_paths`.

## Consequences

La hoja edita `isAllowedPath` en `src/projects/indexer.ts` y añade casos en `src/projects/indexer.test.ts`.

## Forbidden

Hacer el indexador recursivo. Cambiar `chunk_words`. Tocar `main.ts`.

## Cite in code

```text
// DEC-0013: la carpeta pedida tiene que caber en un read_path
```
