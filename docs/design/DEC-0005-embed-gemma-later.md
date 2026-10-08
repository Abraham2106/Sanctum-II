# DEC-0005 — Embedding: API Gemini ahora, EmbeddingGemma 2 después

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

Los embeddings siguen siendo la API HTTP de Gemini, 768 dimensiones, modelos `gemini-embedding-2` y luego `gemini-embedding-001`, texto cortado a 3000 caracteres. Esos cuatro hechos viven en `src/embeddings/embed-contract.ts`. El plugin (`GeminiBalancer`, transporte `requestUrl`) y el MCP (`embedText`, transporte `fetch`) importan ese contrato y no copian la lista ni el cuerpo JSON. La rotación de claves del plugin no se mueve. El MCP sigue recibiendo la primera clave, como hoy.

## Why

El humano pidió usar más adelante el embedding abierto de Gemini. Ese modelo es EmbeddingGemma 2 (`google/embeddinggemma-2`, Apache-2.0, salida 768). Corre en local con otro runtime. Bajar pesos o añadir Python ahora no indexa el vault y obliga a rehacer el JSONL si las dimensiones o el espacio no coinciden. El contrato compartido es el punto donde se sustituye el cuerpo HTTP, sin mezclar vectores de dos modelos en el mismo índice.

## Consequences

Un comentario `ponytail:` en `embed-contract.ts` nombra el techo (hace falta clave de Gemini) y el disparador (sustituir la llamada HTTP por EmbeddingGemma 2 cuando exista un runtime local, y reindexar; no mezclar vectores).

## Forbidden

Descargar el modelo, añadir `sentence-transformers` o cualquier dependencia, cambiar `indexer.ts`, `query-vault.ts` o `mcp-server/index.ts`, y unificar los transportes `requestUrl` y `fetch`.

## Cite in code

```text
// DEC-0005: un contrato de embedding; la API de Gemini es la única implementación
// ponytail: solo API Gemini. Techo: sin clave no hay vectores. Subir a EmbeddingGemma 2 (google/embeddinggemma-2, 768-d) con runtime local y reindexado; no mezclar vectores.
```
