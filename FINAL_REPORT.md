# Informe final — self-improve 2026-10-08

## Resumen

Sanctum II es un plugin de Obsidian y un servidor MCP sobre un vault local. Esta sesión partió de `cursor/sanctum-refactor-9918` (`b4aa0f5`), no de `origin/main`, porque ahí está el producto con el router de chat y la poda.

Ocho defectos quedaron corregidos y medidos. La suite pasó de 138 a 182 tests. `npm run verify` (typecheck, vitest, build, smoke MCP 18/18) termina en 0. Los tests nuevos son la evidencia.

Primera parada a las 10:20Z. El humano pidió seguir a las 17:21Z. Esa tanda cerró a las 17:24Z con dos defectos más.

## Métricas

| Métrica | Antes (09:51Z) | Después (10:17Z) |
|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 |
| vitest | 12 archivos, 138 passed, 762 ms | 19 archivos, 182 passed, 1.11 s |
| `npm run build` | no corrido | ok |
| `mcp:smoke` | no corrido | 18/18 |

## Cambios

| Qué | Commit de la hoja | Qué se demostró |
|---|---|---|
| `globMatch` compara el path entero. `**` cruza carpetas. Una barra final sigue siendo la carpeta. | `dafa4c5`, corrección `1ba3077` | `Research/*.md` ya no acepta `Research/nota.md.exe`. `/Projects/test/` sigue cubriendo `Projects/test/nota.md`. El primer merge rompió ese caso; el segundo lo dejó verde. |
| Un `total_score` que no es un número finito vale 0, no 80. | `92a28d5` | Un JSON sin score ya no entra al mesh como 80. |
| El índice parcial no sube a la carpeta padre. | `a6b4395` | Pedir `Vault` con `read_paths` `Vault/Research` devuelve "fuera" y no indexa. |
| La cadena no acepta un crítico mudo. | `d1ed476` | Sin score ni `accept` explícito, el intento no pasa. `chain-view.ts` quedó más corto. |
| El coseno de distinto largo vale 0. | `fcf9bb2` | `[1,0]` contra `[1]` era `NaN` y ese `NaN` ordenaba por encima de 0.2. Ahora es 0. Iguales siguen en 1, opuestos en −1. |
| Un título de menos de 3 letras no secuestra la nota. | `9782e20` | El título `"a"` ya no coincide con `"modifica la nota"`. `"ML"` no coincide dentro de `"HTML"`. |
| El MCP recorre todas las claves Gemini. | `fc46918` | Un 429 prueba la clave siguiente. Un 500 no. Un 404 pasa al modelo siguiente. |
| `modify_note` usa `noteName` y, si no está, el mensaje. | `b4e0eda` | `"modifica la nota"` ya no pisa la nota titulada `"nota"` cuando el orquestador nombró `QML Research`. |
| Quitar un adjunto no vacía la nota. | `c94a72e` | El botón ya no hace `write("")`. El archivo sale de la lista aunque ya no esté en el vault. |

Los merges en la rama son `acb28b9`, `226b3ac`, `2c246b7`, `a895a43`, `fe1c572`, `f5a08b3`, `41cf43f`, `3e9c1bb`.

## Descartado

- `ChainStore.delete` escribe una cadena vacía en vez de borrar el archivo. No tiene ningún llamador.
- Partir archivos de más de 400 líneas. Ya se revirtió en la rama anterior y sube el diff.
- Indexador recursivo. DEC-0006 lo deja fuera.
- `npm audit fix`. Había 7 avisos tras `npm ci`. No se tocó el árbol de dependencias.
- Pasar `decision.noteName` al resolver. El comentario del orquestador dice que se usa y el llamador manda el mensaje entero. El arreglo del título cubre el caso medido. Mover el llamador no tiene un test corto.
- T-019 falló dos veces por `resource_exhausted`, sin editar nada. El tercer spawn sí implementó la hoja.

## Riesgos y no verificado

- No hay Obsidian de escritorio en este entorno. El bucle de la cadena se probó con la función pura, no con un clic en el lienzo.
- La rotación de claves se probó con `fetch` sustituido. No hubo una llamada real a Gemini.
- Un patrón que termina en `/` sigue siendo un prefijo. `Research/../secret` coincidiría con `/Research/` si esa cadena llegara al glob. El adaptador MCP rechaza `..` antes de leer. No se comprobó el adaptador de Obsidian.
- Un título de 4 letras que sea una palabra del mensaje, por ejemplo `"nota"`, todavía coincide.
- El test de `NaN` en `parse.test.ts` no inyecta `NaN`: `JSON.stringify(NaN)` escribe `null`. El código usa `Number.isFinite` igual.

## Fuentes

No hubo un artículo externo que cambiara el diseño. Cada decisión salió de leer el código y de ejecutarlo: una sonda `node` del glob y del coseno, y el test ya existente de `canWriteToPath` con `/Projects/test/`. Los proyectos nacen con `read_paths` `/Research/` y `/Projects/{id}/` en `src/projects/types.ts`.

## Siguiente

1. Pasar `decision.noteName` cuando venga informado, y dejar el mensaje como respaldo.
2. Si `ChainStore.delete` llega a tener un botón, borrar con `adapter.remove`.
3. Revisar los 7 avisos de `npm audit` a mano, sin `audit fix --force`.

## Discord (DEC-0019)

El bot de Sanctum v1 no servía en este vault: logs JSON, `!resumen`, sync de todo el servidor y un cliente nuevo por envío. El proceso nuevo escribe `Discord-logs/{channelId}.md`, escucha solo los canales de `DISCORD_CHANNEL_IDS`, y contesta si lo mencionan o el mensaje empieza por `!sanctum`. Al arrancar, si la nota está vacía, baja 50 mensajes y no responde. La respuesta entra en la misma nota.

Grok entra por el cable OpenAI que ya existía. `XAI_API_KEY` fija la base `https://api.x.ai/v1` y el modelo `grok-4.7` (o `XAI_MODEL`). Grok Bot, el producto de xAI, publica Slack y no Discord. El vault llega a ese producto con el MCP stdio de siempre, no con un servidor nuevo.

`npm run verify` a las 20:01Z: typecheck 0, 21 archivos, 201 tests, build ok, smoke MCP 18/18. Sin token el proceso sale con código 1. No se llamó a Discord ni a xAI. Hace falta el Message Content Intent en el portal de Discord. El token queda en el entorno del proceso.

## Grok Bot (DEC-0020)

Grok Bot es el sistema de xAI. No tiene una API para enviarle un mensaje. El gancho publicado es un conector MCP custom en grok.com/connectors, con transporte Streamable HTTP. `npm run mcp:http` escucha en `127.0.0.1` (puerto 8787) y responde en `POST /mcp`. La URL que se pega en el conector es la de un túnel HTTPS hacia ese puerto, terminada en `/mcp`. `XAI_API_KEY` en Discord sigue eligiendo el modelo de chat; no abre Grok Bot.

## MCP (DEC-0021)

El servidor no anunciaba cómo usarlo, no listaba notas y las tools de modelo decían que reunían contexto con el vault vacío. `initialize` ahora trae `instructions`. `sanctum_list_notes` devuelve los `read_paths` o un nivel de `.md`. `context` en invocar y en el mesh entra al prompt y se corta a 8000 caracteres. Esas dos siguen sin buscar solas. Un POST de más de 1 MiB responde 413. `npm run verify` a las 22:31Z: 217 tests, smoke 18/18, seis tools.

Quedó fuera: `resources/list`, una sesión `Mcp-Session-Id`, OAuth, y sacar el MCP a otro paquete.

## Cómo revertir

La rama es `self-improve/2026-10-08`. No se hizo push a `main`. Para quitar la sesión, no merges esta rama. El padre es `b4aa0f5` en `cursor/sanctum-refactor-9918`.
