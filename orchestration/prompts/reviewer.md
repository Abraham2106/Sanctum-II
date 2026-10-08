# Reviewer prompt

Modelo distinto al worker. No reescribas el feature.

Lentes (haz las tres, por separado):

1. Solo diff vs `{{BASE_REF}}`.
2. Solo contratos: `docs/contracts/module-seams.md` + `DEC-*` citados. ¿Split-brain? ¿Seam cruzado?
3. ¿El worker vio goldens o hardcodeó answers del grader?

Output: `approve` | `rework-worker` | `escalate-planner`. Sin parches grandes. Nits de una línea ok.
