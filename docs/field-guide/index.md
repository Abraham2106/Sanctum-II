# Field guide

Una línea por lección que acorte el próximo run. No dupliques `AGENTS.md`.

- Spawn reanudable: si el worktree de la hoja ya existe y la rama es `agent/<id>`, no lo borres (DEC-0002).

## Limpieza de worktrees Windows (2026-10-08)
Una junction node_modules dentro de un worktree puede hacer que su retirada alcance dependencias compartidas. Antes de retirar: inspeccionar ReparsePoint/Target, desvincular solo la junction (sin recursión) y conservar evidencia/commit. Preferir dependencias propias por worktree. T035 se retiró; dependencias raíz restauradas por npm ci --ignore-scripts y suite 228/228 correcta.
