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
| DEC-0013 | un índice parcial no puede subir a la carpeta padre | accepted |
| DEC-0014 | la cadena no acepta un crítico sin score ni accept explícito | accepted |
| DEC-0015 | coseno con largos distintos o no finitos vale 0 | accepted |
| DEC-0016 | un título de menos de 3 letras no secuestra la nota | accepted |
| DEC-0017 | modify_note resuelve primero decision.noteName | accepted |
| DEC-0018 | quitar un adjunto no escribe el archivo | accepted |
| DEC-0019 | Discord conversa en Markdown; el modelo Grok solo con XAI_API_KEY | accepted |
| DEC-0020 | Grok Bot entra al vault por POST /mcp en 127.0.0.1 | accepted |

Si dos planners contradicen una fila, no se mergea código. Se abre reconciliación de docs y se incrementa el id. No se agregan sufijos al id. Decisiones de producto empiezan en DEC-0003.
