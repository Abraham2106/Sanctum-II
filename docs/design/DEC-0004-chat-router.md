# DEC-0004 — Router de chat: OpenAI-compatible y Claude

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

El turno de chat lo arma un solo módulo, `src/llm/chat-wire.ts`, sin dependencias nuevas. Habla dos cables:

1. `openai` — `POST {baseUrl}/chat/completions` con `Authorization: Bearer`. Cubre OpenAI, OpenCode, OpenRouter y cualquier servidor compatible. La base y la clave siguen siendo `opencodeBaseUrl` y `opencodeApiKey`. El modelo por defecto sigue `DEFAULT_MODEL` (`deepseek-v4-flash`). No se añade `/v1` si el usuario no lo escribió.
2. `anthropic` — `POST {anthropicBaseUrl}/v1/messages` con `x-api-key` y `anthropic-version: 2023-06-01`. Base por defecto `https://api.anthropic.com`. `max_tokens` fijo en 4096. El system sale de los mensajes `system`. La respuesta lee el primer bloque `text`. `input_tokens` y `output_tokens` se mapean a `prompt` y `completion`.

La clase exportada sigue llamándose `OpenCodeClient`, con `chat()` y `configured` iguales para los llamadores. El constructor sigue siendo `(baseUrl, apiKey)` y acepta un tercer argumento opcional `{ provider, model, anthropicApiKey, anthropicBaseUrl }`. `provider` ausente significa `openai`.

El MCP no cambia la firma de `opencodeChat(system, user, baseUrl, apiKey)`. El cable Anthropic y el modelo salen de `LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY` y `ANTHROPIC_BASE_URL` leídos dentro de `mcp-server/src/llm/opencode-chat.ts`.

## Why

El humano pidió un proveedor intercambiable al estilo OpenAI, Claude o Cursor. Cursor no tiene chat completions público: `@cursor/sdk` lanza un agente Node con binarios nativos, y el plugin de Obsidian no puede cargarlo (CSP y `requestUrl`). Meter ese SDK en el turno de chat cambia el producto. El router propio de dos cables es el recorte que cumple el pedido sin una librería de 30 proveedores.

## Consequences

Ajustes nuevos en `SanctumSettings`: `llmProvider` (`"openai"` | `"anthropic"`, default `"openai"`), `llmModel` (string, default `""` = usar `DEFAULT_MODEL`), `anthropicApiKey` (default `""`), `anthropicBaseUrl` (default `"https://api.anthropic.com"`). `configured` es verdadero si el cable activo tiene clave. El plugin pasa esos campos al construir el cliente en `main.ts`. La UI de ajustes muestra proveedor, modelo y los dos pares clave/base. `.env.example` documenta las variables nuevas y no borra las viejas.

Un test de `chat-wire` cubre el armado y el parseo de los dos cables, sin red.

## Forbidden

Añadir `@cursor/sdk`, `llmkit`, `ai`, `openai` u otra dependencia. Renombrar `OpenCodeClient` o los campos `opencodeApiKey` / `opencodeBaseUrl`. Cambiar `chat-orchestrator.ts`, `agent-turn.ts`, `services.ts` o las tools MCP. Elegir un modelo Claude en silencio cuando el modelo guardado es el default de OpenCode. Un comentario en `chat-wire.ts` deja el techo: Cursor queda fuera del turno de chat hasta una hoja MCP que llame `Agent.send` y devuelva solo el texto final.

## Cite in code

```text
// DEC-0004: dos cables de chat, sin SDK de Cursor en el plugin
// ponytail: Cursor no es chat completions. Techo: este turno no llama modelos de Cursor. Subir cuando una hoja solo-MCP use @cursor/sdk y devuelva el texto final.
```
