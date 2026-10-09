# DEC-0016 — un título corto no secuestra la nota

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

`resolveNoteReference` compara en minúsculas. El título contiene la consulta: coincide, como hoy. La consulta contiene el título solo si el título, ya recortado, tiene al menos 3 caracteres y aparece entre bordes que no son letra ni dígito. Un título vacío no coincide.

## Why

La consulta es el mensaje entero. `query.includes(title)` hace que un título `"a"` coincida con `"modifica la nota"`, y `"ML"` coincida dentro de `"HTML"`. El resolver devuelve esa nota como exacta y puede modificar el archivo equivocado. Los tests actuales buscan `"QML"` dentro de `"QML Research"` y `"quantum"` dentro de `"Quantum ML Research"`; eso es el título que contiene la consulta y se queda.

## Consequences

La hoja edita `src/orchestrator/note-resolver.ts` y crea `src/orchestrator/note-resolver.test.ts`. `permissions.test.ts` no se edita y tiene que seguir en verde.

## Forbidden

Cambiar el umbral 0.05 del RAG, el llamador en `chat-orchestrator.ts`, o exigir que el modelo mande `noteName`.

## Cite in code

```text
// DEC-0016: un título de menos de 3 letras no coincide dentro de la frase
```
