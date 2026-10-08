# DEC-0019 — Discord conversacional, Grok solo en ese proceso

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

El proceso de Discord escribe cada canal permitido en `Discord-logs/{channelId}.md`, contesta solo si lo mencionan o el mensaje empieza por `!sanctum`, y llama a Grok con el cable OpenAI ya existente cuando `XAI_API_KEY` está puesta. Sin esa clave usa `OPENCODE_GO_*`.

## Why

El bot de Sanctum v1 no servía: logs JSON que este indexador no lee, `!sync` / `!resumen`, sincronizar todo el servidor cada hora, y un cliente nuevo por cada envío. Grok Bot (docs.x.ai/grok-bot) habla con el equipo por su app y por Slack. No publica un conector ni un webhook de Discord. El vault ya entra a ese producto como MCP por comando (`node mcp-server/dist/index.cjs`). Esta hoja no crea otro servidor.

El cable de chat hace `POST {base}/chat/completions`. La base de xAI documentada es `https://api.x.ai/v1` y el modelo de los ejemplos vigentes es `grok-4.7`. Chat completions figura como legacy; no se añade `/v1/responses` porque el cable de DEC-0004 no lo habla.

## Consequences

`opencodeChat` no sirve aquí: elige proveedor y modelo desde `LLM_PROVIDER` y `LLM_MODEL`. El bot arma el request con `buildOpenAiWire` y lo manda con `fetch`. `discord.js` solo lo importa `discord-bot/index.ts`. El plugin y el MCP no cambian de entry.

Forma del log, una línea por mensaje, saltos de línea del texto colapsados a espacio:

```text
# nombre

- {id} {at} **{author}**: {content}
```

`mergeLines` descarta un id repetido y cualquier texto que empiece por `!` salvo `!sanctum`. `shouldAnswer` es verdadero con mención o con `!sanctum`. El system prompt sale de `sanctum-agents/discord.md`: `{{rag_context}}` es el tramo (40 líneas, `autor: texto`) y `{{user_prompt}}` es la pregunta ya sin el comando. La respuesta se corta a 1900 caracteres. Si el modelo falla, el canal recibe `No pude responder.` y el cuerpo del error se queda en stderr.

Al conectar, si la nota del canal no existe o no tiene líneas, se bajan los últimos 50 mensajes una vez y no se contesta. Escrituras del mismo canal en serie. Canales fuera de `DISCORD_CHANNEL_IDS` no se leen. Lista vacía, sin token o sin guild: el proceso sale.

## Forbidden

Logs JSON, `!sync`, `!resumen`, sync horario, un Client por envío, RAG o mesh por mensaje, tocar `esbuild.config.mjs`, `src/main.ts`, `mcp-server/index.ts` o `src/llm/chat-wire.ts`, meter el token en el vault o en ajustes de Obsidian, un MCP remoto, y llamar a la API de xAI o a Discord en los tests.

## Cite in code

```text
// DEC-0019: Discord conversa; Grok solo si hay XAI_API_KEY
```
