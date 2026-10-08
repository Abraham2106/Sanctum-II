# DEC-0007 — Poda: solo símbolos sin llamadores

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

Se borra código que el árbol ya no referencia. Nada más. Un símbolo se borra solo si una búsqueda en el worktree no muestra ningún uso fuera de su definición. Un archivo se borra solo si nadie lo importa.

Lista cerrada de esta ola, ya comprobada en el árbol integrado:

- `src/constants.ts`: `KG_DIR`, `MESH_THRESHOLDS`, `INDEX_DIR_BASE`, `MEMORY_DIR_BASE`, `THREADS_DIR_BASE`
- `src/ui/chain-inspector.ts` (el archivo entero)
- `shouldRegenerate` en `src/shared/mesh/core.ts`, y el import que quede sin uso
- `DEFAULT_KG_OPTIONS` en `src/kg/types.ts`
- `AgentAuthoringOptions` en `src/agents/authoring/types.ts` (no borres `AgentAuthoringLLM` si otro tipo la usa)
- la variable `previousOutput` en `src/chains/executor.ts`

Si el worker, al rebuscar, encuentra un uso, lo deja. Si encuentra otro símbolo con cero usos dentro de su seam, lo borra y lo anota en el handoff. No reescribe funciones vivas para acortarlas.

## Why

Ponytail: el código que nadie llama se lee, se prueba y se rompe igual. Esta ola no cambia comportamiento.

## Consequences

Cada borrado cita `DEC-0007`. No hay test nuevo: no hay rama nueva. La suite sigue siendo T-006, después de estas hojas.

## Forbidden

Borrar `papepssss.md`, tests, prompts de `sanctum-agents/` o `sanctum-skills/`, o cualquier símbolo con un llamador. No sustituir literales de rutas por las constantes que se borran. No añadir abstracciones.

## Cite in code

```text
// DEC-0007: símbolo sin llamadores
```
