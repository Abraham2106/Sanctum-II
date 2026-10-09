# DEC-0011 — el MCP recorre todas las claves Gemini

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

`embedText` parte la cadena de claves por comas. Ante 429 o 403 prueba la clave siguiente con el mismo modelo. Ante 404 o 400 pasa al modelo siguiente. Otro estado se propaga. `mcp-server/index.ts` pasa todas las claves de `GEMINI_API_KEYS`, no solo la primera. Cero claves sigue siendo “no configurado”.

## Why

El plugin rota claves en `GeminiBalancer`. El MCP se queda en `split(",")[0]`. Si la primera clave está agotada, `sanctum_query_vault` falla teniendo otra clave válida. No se importa `GeminiBalancer`: ese cliente usa `requestUrl` de Obsidian.

## Consequences

La hoja edita `mcp-server/index.ts` y `mcp-server/src/embeddings/gemini-embed.ts`, y crea `mcp-server/src/embeddings/gemini-embed.test.ts`. El test puede sustituir `globalThis.fetch`; el código de producción sigue llamando a `fetch`. No es un mock de producto.

## Forbidden

Editar `query-vault.ts`, el balancer del plugin o el contrato de `embed-contract.ts`. Añadir dependencias. Llamar a la API real en el test.

## Cite in code

```text
// DEC-0011: una clave Gemini en 429 no agota las demás
```
