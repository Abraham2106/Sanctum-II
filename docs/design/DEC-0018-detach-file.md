# DEC-0018 — quitar un adjunto no borra la nota

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

Quitar un archivo de la lista del proyecto lo saca de `attachedFiles` y de `files`. No escribe el archivo. Si el archivo ya no está en el vault, igual se puede quitar de la lista.

## Why

El botón dice "Quitar del proyecto" y luego hace `adapter.write(path, "")`. Eso vacía la nota. El `exists` previo además deja el adjunto colgado cuando el archivo ya desapareció.

## Consequences

Una función pura hace el recorte. La vista la llama y borra el `write`. El test cubre la función. El diff de la vista no puede volver a escribir el archivo.

## Forbidden

Borrar el archivo del vault. Cambiar el texto del confirm, el dropzone, o el CSS. Partir `projects-view.ts`.

## Cite in code

```text
// DEC-0018: quitar del proyecto no vacía la nota
```
