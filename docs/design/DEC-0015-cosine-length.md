# DEC-0015 — coseno de distinto largo vale 0

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

`cosineSimilarity` devuelve 0 si los vectores no tienen el mismo largo, si alguno está vacío, o si algún componente no es finito. Vectores del mismo largo y finitos conservan el cálculo actual, incluido el opuesto −1.

## Why

El bucle usa `a.length`. Si `a` es más largo, `b[i]` es `undefined` y el resultado es `NaN`. En este runtime `NaN` queda primero al ordenar por score, por encima de una similitud real de 0.2. Un vector más corto que el otro puede devolver 1 usando solo el prefijo.

## Consequences

La hoja edita `cosineSimilarity` en `src/rag/vector-store.ts` y crea `src/rag/cosine.test.ts`. No edita `permissions.test.ts` ni `kg.test.ts`.

## Forbidden

Cambiar el ranking, el umbral 0.65 o el formato del almacén. Añadir una dependencia.

## Cite in code

```text
// DEC-0015: largos distintos no pueden ganar el ranking con NaN
```
