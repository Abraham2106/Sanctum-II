# DEC-0021 — el MCP dice la verdad y deja ver las notas

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes:

## Decision

El MCP anuncia en `initialize` cómo se usa, marca qué tools solo leen y cuáles llaman a un modelo, lista un nivel de notas, acepta un `context` que el cliente ya recuperó, y rechaza un POST de más de 1 MiB.

## Why

Grok Bot solo ve lo que el servidor declara. Hoy `initialize` no trae `instructions`. No hay forma de listar notas: `sanctum_get_note` exige un path y `sanctum_query_vault` exige índice. `sanctum_invoke_agent` y `sanctum_run_mesh` dicen que reúnen contexto y pasan `{{rag_context}}` vacío. El HTTP no corta el cuerpo, y ese puerto se publica con un túnel.

Sacar el MCP a otro paquete no cierra eso. Ya es un proceso aparte.

## Consequences

`instructions` es este texto, en `initialize`:

```text
Sanctum es un vault local de notas Markdown. Para verlo: sanctum_list_notes, sanctum_get_note y sanctum_query_vault. La búsqueda exige índice y GEMINI_API_KEYS. sanctum_list_agents enumera agentes. sanctum_invoke_agent y sanctum_run_mesh no leen el vault: pasan context a {{rag_context}} y gastan OPENCODE_GO_API_KEY.
```

`tools/list` incluye `annotations` si la tool las trae. `readOnlyHint` true en listar, leer y buscar. `openWorldHint` true en buscar (sale a Gemini), invocar y mesh. Invocar y mesh tienen `readOnlyHint` false porque escriben una traza.

`sanctum_list_notes`: sin `folder`, devuelve los `read_paths` y no toca el disco. Con `folder`, un nivel, solo `.md` y carpetas, sin rutas `sanctum-*` ni `docs/`. Hace falta que el folder o `folder/a.md` caiga en `read_paths`. Tope 200 entradas. `..`, absoluto o barra invertida: error, sin listar.

`context` en invocar y en el mesh es string. Entra como rag de ese agente o, en el mesh, solo de Forager. Se corta a 8000 caracteres. Esas tools siguen sin buscar solas.

`POST /mcp` con cuerpo mayor a 1048576 bytes responde 413 y deja de leer.

El smoke sigue viendo `sanctum_list_agents` como primera tool.

## Forbidden

`resources/list`, sesión `Mcp-Session-Id`, OAuth, paginación, un paquete nuevo, que invoke o el mesh llamen al índice, y escuchar fuera de localhost.

## Cite in code

```text
// DEC-0021: el MCP anuncia el uso y lista notas
```
