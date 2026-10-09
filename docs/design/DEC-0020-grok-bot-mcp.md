# DEC-0020 — Grok Bot entra al vault por MCP en HTTP

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes: la frase de DEC-0019 que ofrece el vault con `node mcp-server/dist/index.cjs`

## Decision

Grok Bot, el sistema de xAI, usa Sanctum como conector MCP custom. El mismo servidor escucha en `127.0.0.1` y responde en `POST /mcp` cuando `SANCTUM_MCP_HTTP=1`. El modo stdio no cambia.

## Why

Ese producto no tiene API para mandarle un mensaje ni un conector de Discord. En grok.com/connectors se añade un MCP propio con una URL pública. El transporte que acepta es Streamable HTTP o SSE. Un proceso stdio en el portátil no lo alcanza: el Bot corre en su nube.

`XAI_API_KEY` en el proceso de Discord sigue siendo el modelo de chat. No es Grok Bot.

## Consequences

`McpServer.handleMessage` devuelve la respuesta JSON-RPC que ya arma el stdio. `initialize` devuelve la versión que pidió el cliente si es `2024-11-05`, `2025-03-26` o `2025-06-18`. Si pide otra, responde `2025-03-26`. El smoke que manda `2024-11-05` sigue viendo esa misma.

`POST /mcp` con `Accept: text/event-stream` responde `text/event-stream` y un evento `message` cuyo `data` es el JSON-RPC. Si el `Accept` es solo `application/json`, el cuerpo es ese JSON. Una notificación responde 202 vacío. `GET /mcp` responde 405. Otra ruta responde 404. Un JSON inválido responde 400.

El bind es `127.0.0.1`. El puerto es `SANCTUM_MCP_PORT` o 8787. Si `SANCTUM_MCP_TOKEN` tiene texto, hace falta `Authorization: Bearer` igual a ese texto; si no, 401. Sin token no se pide clave: el límite es el localhost. La URL que se pega en Grok Bot es la del túnel HTTPS hacia ese puerto. Este repo no abre el túnel.

Script: `npm run mcp:http`.

## Forbidden

OAuth, un túnel, un SDK de MCP, escuchar en `0.0.0.0`, tocar el gateway de Discord, y llamar a xAI en los tests.

## Cite in code

```text
// DEC-0020: Grok Bot usa el MCP por POST /mcp
```
