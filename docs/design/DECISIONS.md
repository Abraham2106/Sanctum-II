# Decisions ledger

Fuente compacta para inyectar en workers. Detalle en `DEC-*.md`.

| ID | One-liner | Status |
|---|---|---|
| DEC-0001 | Planner no codea; worker no diseña; worktrees | accepted |
| DEC-0002 | Spawn reanudable; no borrar un worktree ajeno ni su evidencia | accepted |
| DEC-0003 | Refactor por dueño de concepto; sin reescritura ni suite a mitad | accepted |
| DEC-0004 | Chat por dos cables (OpenAI-compatible y Anthropic); sin SDK de Cursor | accepted |
| DEC-0005 | Embedding = API Gemini 768-d; EmbeddingGemma 2 queda nombrado y sin implementar | accepted |
| DEC-0006 | El indexador usa `chunk_words`; la cadena reenvía `pathFilter` | accepted |
| DEC-0007 | Poda solo de símbolos sin llamadores | accepted |
| DEC-0008 | Reescribir por trabajo los cinco archivos de más de 400 líneas | accepted |
| DEC-0009 | globMatch ancla el patrón; ** cruza segmentos | accepted |
| DEC-0010 | total_score ausente o no numérico del crítico vale 0 | accepted |
| DEC-0011 | el MCP recorre todas las claves Gemini ante 429/403 | accepted |
| DEC-0012 | un patrón que termina en / es la carpeta y lo que cuelga | accepted |

Si dos planners contradicen una fila, no se mergea código. Se abre reconciliación de docs y se incrementa el id. No se agregan sufijos al id. Decisiones de producto empiezan en DEC-0003.
