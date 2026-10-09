# DEC-0014 — la cadena no acepta un crítico mudo

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

El bucle de crítico de la vista de cadenas acepta el intento si `total_score` es un número finito ≥ 80, o si el JSON trae `verdict` exactamente `"accept"`. Si falta el score, vale 0. Si falta el veredicto, no cuenta como accept. Un veredicto `"reject"` con score ≥ 80 sigue aceptando por el score, igual que hoy.

## Why

El bucle pone score 80 y veredicto accept antes de leer el JSON, y acepta con `score >= 80 || verdict === "accept"`. Un objeto sin esos campos se acepta. `parseCriticJSON` ya no hace eso en el mesh; esta vista tiene su propia lectura.

## Consequences

Una función pura nueva, su test, y la vista la llama en el bucle. La vista no crece para partirla.

## Forbidden

Cambiar el máximo de 3 intentos, el umbral 80, el modal, el DOM o las clases CSS. Partir `chain-view.ts`.

## Cite in code

```text
// DEC-0014: sin score ni accept explícito la cadena no aprueba
```
