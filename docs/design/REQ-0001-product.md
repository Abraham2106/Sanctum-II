# REQ-0001 — Producto (preflight)

Estado: cerrado por el pedido del humano y por el código ya presente en el repo.

| Campo | Valor |
|---|---|
| Notify | `done` / `killed` / hard-block. Cero preguntas mid-run |
| Dominio | Sanctum II, plugin Obsidian local-first y servidor MCP sobre el vault |
| Qué afirma el sistema | El chat sigue siendo un turno: system + user → texto. El proveedor de ese turno es un router de dos cables: OpenAI `/chat/completions` (sirve OpenAI, OpenCode, OpenRouter y cualquier base compatible) y Anthropic Messages (Claude). Los embeddings siguen saliendo de la API de Gemini a 768 dimensiones. El índice, el grafo, los permisos y el vault no cambian de forma. |
| Qué queda fuera | No se reescribe la UI. No se indexa en subcarpetas. No se borra `papepssss.md`. No se reescribe el README. No se añade `@cursor/sdk`. No se descarga EmbeddingGemma. |
| Hechos que no se pueden inventar | Cursor no publica `/v1/chat/completions`. `@cursor/sdk` es un arnés de agente Node, no un cliente de chat, y no entra en el bundle del plugin. EmbeddingGemma 2 (`google/embeddinggemma-2`, Apache-2.0, 768-d) es el embedder abierto de la familia Gemini, para más adelante, no para esta ola. Los campos ya guardados `opencodeApiKey` y `opencodeBaseUrl` siguen siendo la clave y la base del cable OpenAI. |
| API o superficie mínima | Ajustes: proveedor `openai` o `anthropic`, modelo, clave y base ya existentes, más clave y base de Anthropic. MCP lee `LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` y sigue aceptando `OPENCODE_GO_*` para el cable OpenAI. |
| Verificación (comandos reales) | Al cierre, una sola vez: `npm run typecheck` y `npm test`. Los workers no corren la suite. |
| Secrets | Ninguna clave nueva en el repo. `.env.example` solo nombres. |
| Done de esta ola | Un solo dueño del cable de chat, un solo dueño de los números RAG y de las rutas de traza, el indexador usa `project.rag.chunk_words`, la cadena pasa el filtro de carpeta activa, y el contrato de embedding nombra EmbeddingGemma 2 sin implementarlo. |
