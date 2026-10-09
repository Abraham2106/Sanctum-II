# Autonomy

Modo: **autónomo tras preflight**. El humano no es un chatbot de diseño a mitad de run.

## Cuándo existe el humano

1. **Antes** — responde `docs/design/REQ-0001-product.md` y quita cada `UNANSWERED`.
2. **Después** — notificación de estado terminal.

Nada en medio. Si falta un hecho, no se improvisa: el planner escribe `orchestration/runs/BLOCKED.md` y se notifica **hard block**.

## Notificar cuando

`done` | `killed` | hard-block del run entero.

No notificar: dudas de una hoja, nits de review, nombres de módulo.

Canal: `orchestration/runs/NOTIFY.md`.

## Preflight

`powershell -File orchestration/orchestrate.ps1 preflight`

Falla si `REQ-0001-product.md` no existe o contiene el token `UNANSWERED`.

## Run

Código de dominio: subagentes worker (Composer 2.5), un seam por worktree. El chat planner no implementa.

Si el paquete no cierra el preflight → hard-block inmediato, sin empezar código.
