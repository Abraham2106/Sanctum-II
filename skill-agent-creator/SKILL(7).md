---
name: skill-creator
description: "Genera nuevas skills de Sanctum-II en formato boilerplate (frontmatter name+description, cuerpo Markdown, sin YAML anidado ni campos inventados). Úsala cuando el usuario pida crear, redactar, mejorar o revisar una skill; cuando describa un flujo repetible que un agente debería seguir (investigación, resumen, extracción, escritura de notas, formato de citas); cuando mencione 'system prompt para X', 'plantilla de investigación', 'quiero que el agente siempre haga Y'; o cuando entregue un .md de skill vacío/genérico y pida robustecerlo. No la uses para crear agentes completos (identidad, tools, permissions, triggers) — para eso usa agent-generator. Palabras clave: skill, .md de skill, prompt reutilizable, plantilla de respuesta, formato de citas, sanctum-skills/."
---

# Skill Creator (Sanctum-II)

Genera y audita skills para `sanctum-skills/*.md`. Una skill en Sanctum-II **no** es un archivo de configuración — es el system prompt operativo que un agente carga cuando el usuario la invoca (por mención `/nombre-skill` en el chat, o por asignación en un nodo del orquestador visual). Si el cuerpo es vago, la respuesta del agente será vaga. Esta skill existe para que eso no pase.

## Cuándo aplicar esta skill y cuándo no

**Aplícala cuando:**
- El usuario pide crear una skill nueva desde cero.
- El usuario tiene un `.md` de skill existente pero está vacío, genérico o no produce el comportamiento que espera ("la respuesta sigue sonando robótica", "no cita bien", "mezcla fuentes internas y web sin criterio").
- El usuario describe un comportamiento repetible en prosa ("quiero que cuando le pida resúmenes, siempre entregue viñetas con la fecha de la fuente") y ese comportamiento es independiente del agente que lo ejecute.

**No la apliques cuando:**
- Lo que se pide es un agente completo (con `tools`, `permissions`, `triggers`, `avatar`, conexiones en el mesh). Eso es responsabilidad de `agent-generator`. Una skill no declara `tools` propias más allá de las heredadas por el agente que la invoca — la única superficie declarativa propia de una skill, además de `name`/`description`, es `tools` (lista informativa de lo que asume disponible) y opcionalmente `permissions` (ver más abajo).
- Lo que se pide es una cadena visual (`chains/`) conectando varios agentes. Una skill es un prompt, no un grafo de nodos.
- El usuario solo quiere ejecutar una skill existente ("usa deep-research para investigar X") — eso no es crear una skill, es usarla.

Si la petición mezcla ambas cosas ("créame un agente investigador con su propia skill de citas APA"), primero resuelve la skill con esta guía y deja explícito que el agente en sí requiere `agent-generator`.

## Formato boilerplate de Sanctum-II (supuesto explícito)

> **Supuesto:** basado en `deep-research.md`, `web-search.md` y la tabla de skills del README, el formato real de una skill en este proyecto es:
> ```
> ---
> id: <slug-kebab-case>            # obligatorio, coincide con el nombre de archivo sin .md
> name: "<Nombre visible>"          # obligatorio
> avatar: "<emoji>"                 # opcional, solo si la skill es seleccionable con ícono propio en la UI
> description: "<qué hace>"         # obligatorio
> tools: [tool_a, tool_b]           # opcional, lista informativa de tools que la skill asume disponibles
> permissions:                      # opcional — SOLO si la skill necesita restringir/ampliar acceso más allá del agente que la invoca
>   read_paths: ["/**"]
>   write_paths: []
> ---
> Cuerpo en Markdown: system prompt operativo.
> ```
> No existe un esquema JSON validado para skills en el repositorio adjunto — el frontmatter se infiere de los tres ejemplos disponibles. Si el proyecto define una validación más estricta (p. ej. un tipo TypeScript en `src/skills/`), esa fuente tiene prioridad sobre esta guía.
>
> Sobre `permissions` en skills: úsalo solo cuando la skill necesite comunicar una restricción o requisito de acceso que es inherente a *lo que la skill hace* (p. ej. una skill de solo-lectura que nunca debería poder escribir notas, independientemente de qué agente la invoque). Si la skill no impone ninguna restricción propia, omite el bloque completo — el acceso efectivo ya lo determina la intersección de rutas del agente y del proyecto (ver README, sección Seguridad y privacidad), y declarar `permissions` sin necesidad real solo añade ruido.

El único campo verdaderamente libre es el cuerpo Markdown. Ahí es donde vive el 90% del valor de una skill, y donde más fallan las plantillas vacías.

## Flujo paso a paso

### 1. Captura de intención

Antes de escribir una sola línea, responde (mentalmente o preguntando al usuario si no es obvio):

1. **¿Qué debe producir la skill?** — no "una buena respuesta", sino el formato concreto: ¿secciones fijas?, ¿tabla?, ¿lista con viñetas?, ¿nota Markdown completa?
2. **¿De qué fuentes se alimenta?** — `{{rag_context}}` (vault), `{{web_context}}` (búsqueda web), ambas, ninguna (skill puramente de reescritura/formato).
3. **¿Cómo debe citar?** — `[[wikilink]]` para vault, `(Autor, Año). URL` estilo APA para web, ambos, o ninguno si la skill no maneja fuentes.
4. **¿Qué NO debe hacer?** — esto es tan importante como el punto 1. Los tres ejemplos de referencia (`deep-research`, `web-search`, `agente_base`) todos incluyen una prohibición explícita: no narrar el proceso de búsqueda, no crear secciones "Del vault"/"De la web", no escribir "tu vault" ni "tus notas". Esa clase de restricción negativa es lo que separa una skill genérica de una que realmente controla el estilo de salida.

Si el usuario no puede responder el punto 4 todavía, no está listo para congelar la skill — pero puedes proponer un borrador razonable y pedirle que lo corrija, en vez de bloquear el proceso con más preguntas.

### 2. Escribe un `name` y una `description` recuperables

La `description` es lo único que el orquestador (o el usuario buscando en la lista de skills) ve antes de invocar la skill. Si es vaga, la skill nunca se usa aunque el cuerpo sea excelente.

Fórmula: **[qué hace] + [con qué fuentes/formato] + [cuándo usarla, con sinónimos]**.

| Débil (evitar) | Fuerte (imitar) |
|---|---|
| `"Ayuda con investigación"` | `"Investigación profunda multi-fuente con síntesis: contrasta vault y web, cita en línea, ofrece guardar como nota. Úsala para preguntas comparativas o de estado del arte, no para lookups simples de un dato."` |
| `"Resume texto"` | `"Resume notas largas del vault en viñetas con fecha de fuente y wikilink. Úsala cuando el usuario pida 'resume esto', 'dame los puntos clave' o adjunte una nota extensa — no la uses si solo pide una definición corta."` |

Reglas concretas:
- Incluye **palabras clave de disparo** que el usuario realmente escribiría (sinónimos incluidos), igual que esta misma skill lista "system prompt para X", "plantilla de investigación".
- Incluye **cuándo NO usarla** si hay una skill vecina con la que se pueda confundir (como esta sección lo hace respecto a `agent-generator`).
- Una sola frase de 2-4 líneas es suficiente. No repitas el cuerpo de la skill en la descripción.

### 3. Estructura el cuerpo

Usa este orden, adaptándolo según lo que la skill necesite (no todas las secciones aplican siempre):

1. **Rol en una frase.** ("Eres un investigador experto." / "Eres un asistente que responde de forma directa y verificable.") Sin relleno de personalidad si no aporta a la tarea.
2. **Proceso interno (si existe), marcado explícitamente como no-narrado.** Si la skill debe consultar varias fuentes antes de responder, dilo — pero deja claro que ese proceso no debe aparecer en la respuesta final. Los tres ejemplos de referencia hacen esto de forma consistente.
3. **Reglas de contenido.** Qué debe incluir la respuesta (specificidad: cifras, nombres, fechas — no generalidades) y qué debe evitar (frases de relleno, preámbulos tipo "he buscado...").
4. **Formato de salida**, con plantilla explícita si el formato es fijo:
   ```markdown
   ## Formato de la respuesta
   - Sección "Definición"
   - Sección "Enfoques"
   - Sección "Resultados"
   - Sección "Limitaciones"
   - Sección "Conclusión"
   ```
   Una plantilla concreta vale más que un párrafo describiendo "una buena estructura".
5. **Reglas de citas y fuentes**, si aplica. Sé exhaustivo aquí: los tres ejemplos de referencia dedican más líneas a citas que a cualquier otra sección, porque es donde más se equivocan los modelos (mezclar fuentes sin distinguir, inventar atribuciones, narrar el origen en vez de citarlo).
6. **Variables de contexto**, si la skill las usa: `{{rag_context}}`, `{{web_context}}`, `{{user_prompt}}`. Van al final del cuerpo, no intercaladas.
7. **Entregable adicional**, si aplica (p. ej. ofrecer crear una nota).

### 4. Decide si necesitas separar contenido en archivos adicionales

El formato boilerplate de Sanctum-II es un único `.md` — no hay convención de `references/` o `scripts/` como carpetas del propio formato de skill (a diferencia del formato de Agent Skills usado en otros entornos Claude, que sí lo soporta con YAML anidado). Aun así, cuando el cuerpo de una skill crece demasiado, dos estrategias funcionan **dentro del mismo archivo**, sin inventar infraestructura nueva:

- **Ejemplos largos al final del cuerpo**, bajo un heading `## Ejemplo`, en vez de intercalados en las reglas. Mantiene las reglas escaneables.
- **Variantes por dominio dentro de la misma skill**, usando sub-headings claros (`### Si la pregunta es sobre código`, `### Si la pregunta es conceptual`) en vez de una sola lista de reglas que intenta cubrir todo a la vez.

Solo considera proponer un archivo separado (p. ej. `sanctum-skills/deep-research.reglas-citas.md` referenciado desde el cuerpo) si el cuerpo supera ampliamente las ~150-200 líneas y una sección concreta (típicamente citas o formato) es reusable por varias skills distintas. Esto no es una convención confirmada del proyecto — indícaselo al usuario como propuesta, no como estándar existente, y confirma que el runtime de Sanctum-II efectivamente carga archivos adicionales referenciados antes de depender de ello.

### 5. Reglas de estilo

- **Imperativo, no descriptivo.** "Empieza con la respuesta sustantiva" en vez de "La respuesta debería empezar con...".
- **Explica el porqué cuando la regla no sea obvia.** No todo necesita justificación, pero una regla como "no descartes los resultados web aunque el vault tenga info similar" es más fácil de seguir con el motivo adjunto ("la web aporta actualidad") que como mandato seco. `web-search.md` lo hace bien.
- **Prohibiciones explícitas, no solo instrucciones positivas.** "No escribas 'tu vault' ni 'según la web'" es más accionable que "sé natural al citar fuentes".
- **Density sobre longitud.** Una skill de 40 líneas densas y específicas supera a una de 150 líneas con relleno. No añadas secciones para parecer completo.
- **Congruencia con las tools declaradas.** Si el frontmatter lista `tools: [web_search, rag_query]`, el cuerpo debe usar ambas fuentes explícitamente (`{{web_context}}`, `{{rag_context}}`) y explicar cómo se combinan. Una skill que declara una tool y nunca la menciona en el cuerpo es una skill a medio terminar.

### 6. Anti-patrones a evitar

| Anti-patrón | Por qué falla | Corrección |
|---|---|---|
| `description: "Ayuda al usuario"` | No es recuperable ni distingue esta skill de ninguna otra | Usa la fórmula del paso 2 |
| Cuerpo que dice "sé útil y preciso" sin más | No es accionable — es una skill vacía con más palabras | Sustituye por reglas de contenido y formato concretas (paso 3.3-3.4) |
| Secciones tituladas por origen de dato ("Del vault", "De la web") | Rompe la narrativa unificada que piden los tres ejemplos de referencia; expone la mecánica interna al usuario final | Usa secciones temáticas por contenido, cita en línea con `[[wikilink]]` o `(Autor, Año)` |
| Narrar el proceso ("He buscado en el índice y en la web...") | El usuario no necesita ver el proceso, necesita la respuesta | Marca el proceso como interno/no-narrado explícitamente en el cuerpo |
| Mezclar `tools` declaradas que el cuerpo nunca usa | Genera expectativas falsas sobre qué hace la skill | Cada tool listada debe tener una instrucción correspondiente en el cuerpo |
| Inventar campos de frontmatter no vistos en los ejemplos (`priority`, `temperature`, `max_tokens`...) | No hay evidencia de que el runtime los lea; genera configuración muerta | Cíñete a `id`, `name`, `avatar`, `description`, `tools`, `permissions` — si el usuario necesita algo más, dilo como supuesto explícito, no lo agregues silenciosamente |
| `permissions` copiado por costumbre sin necesidad real | Ruido que sugiere una restricción que no existe | Omite `permissions` salvo que la skill imponga una restricción propia de acceso (ver paso 2 sobre supuestos) |

### 7. Checklist de pre-entrega

Antes de entregar una skill, verifica:

- [ ] `id` coincide exactamente con el nombre del archivo (sin `.md`) y usa kebab-case.
- [ ] `name` es legible para un humano eligiendo entre skills en una lista.
- [ ] `description` responde qué hace + con qué fuentes + cuándo usarla, en 2-4 líneas, con palabras clave reales de disparo.
- [ ] El cuerpo define un rol en una frase.
- [ ] Si hay proceso multi-paso, está marcado explícitamente como no-narrado.
- [ ] Las reglas de contenido piden especificidad (cifras, nombres, fechas) y prohíben relleno genérico.
- [ ] El formato de salida es una plantilla concreta, no una descripción abstracta.
- [ ] Si la skill maneja fuentes, las reglas de citas cubren: sintaxis exacta por tipo de fuente, prohibición de narrar el origen, y qué hacer si una fuente está vacía.
- [ ] Cada `tools` declarada en el frontmatter tiene instrucción correspondiente en el cuerpo.
- [ ] `permissions` está presente solo si la skill impone una restricción propia — y ausente en caso contrario.
- [ ] No hay secciones tituladas por origen de dato ni tablas de "distinción de fuentes".
- [ ] Las variables (`{{rag_context}}`, `{{web_context}}`, `{{user_prompt}}`) están al final, no intercaladas.
- [ ] El archivo completo es razonablemente escaneable (si supera ~150-200 líneas, revisa el paso 4).

## Ejemplo completo

**Petición del usuario:** "Necesito una skill que tome una nota larga del vault y la convierta en un resumen ejecutivo de máximo 5 viñetas, siempre citando la nota fuente."

**Aplicando el flujo:**
1. Producto: 5 viñetas máximo. Fuente: solo vault (`rag_query`), no web. Cita: `[[wikilink]]` por viñeta. No debe: exceder 5 viñetas, incluir opinión no presente en la fuente, narrar el proceso.
2. `description`: qué hace + fuente + cuándo.
3. Cuerpo con plantilla fija de salida.

**Resultado (`sanctum-skills/resumen-ejecutivo.md`):**

```markdown
---
id: resumen-ejecutivo
name: "Resumen Ejecutivo"
avatar: "📋"
description: "Convierte una nota larga del vault en un resumen de máximo 5 viñetas con cita a la nota fuente. Úsala cuando el usuario pida 'resume esto', 'dame los puntos clave', 'versión corta de esta nota' o adjunte contenido extenso pidiendo síntesis. No la uses para investigación multi-fuente (usa deep-research) ni cuando el usuario pida el resumen de varias notas distintas sin relación directa."
tools: [rag_query]
---
Eres un editor que sintetiza sin opinar. Tu única fuente es la nota que el usuario referencia o el contexto recuperado del vault — nunca conocimiento externo.

REGLAS DE CONTENIDO
- Extrae únicamente lo que la nota fuente afirma. No agregues interpretación, contexto externo ni matices que la nota no contenga.
- Cada viñeta debe ser una idea completa y autónoma — nadie debería necesitar leer la viñeta anterior para entenderla.
- Máximo 5 viñetas. Si la nota tiene más de 5 ideas centrales, prioriza las que el título o los headings de la nota destacan.

FORMATO DE LA RESPUESTA
Usa siempre esta estructura, sin preámbulo:
- Viñeta 1 [[wikilink-nota]]
- Viñeta 2 [[wikilink-nota]]
- (hasta 5)

CITAS
- Cada viñeta cierra con [[wikilink]] a la nota fuente, incluso si todas provienen de la misma nota.
- No escribas "según la nota" ni "de tu vault". La cita ya comunica el origen.
- Si el contexto recuperado está vacío, responde en una sola frase indicando que no hay contenido para resumir — no inventes una nota fuente.

Contexto disponible:
{{rag_context}}

Pregunta del usuario:
{{user_prompt}}
```

Este ejemplo cumple el checklist completo: `description` recuperable con sinónimos y límite de alcance, rol en una frase, regla negativa explícita (no interpretar), plantilla de salida fija, regla de citas con caso vacío cubierto, y sin campos inventados en el frontmatter.
