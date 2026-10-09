# DEC-0017 — modify_note usa noteName si viene

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

Si `decision.noteName` es un string no vacío, `modify_note` resuelve primero con ese texto. Si el resultado es `not_found`, resuelve otra vez con el mensaje del usuario. Si `noteName` no viene, el mensaje sigue siendo la única consulta.

## Why

La variable `noteName` se lee y no se usa. El mensaje `"modifica la nota"` contiene la palabra `nota`, así que una nota titulada `"nota"` gana aunque el orquestador haya dicho `noteName: "QML Research"`.

## Consequences

La hoja edita el bloque `modify_note` de `src/app/chat-orchestrator.ts` y añade casos en `src/note-flow.test.ts`. No parte el orquestador.

## Forbidden

Cambiar `create_note`, el resolver, o el umbral de ambigüedad. Caer al mensaje cuando el resultado es `ambiguous`.

## Cite in code

```text
// DEC-0017: noteName manda; el mensaje solo si ese nombre no está
```
