---
name: agent-generator
description: "Genera agentes completos para sanctum-agents/*.md (identidad, system prompt, tools, permisos, triggers, rol en el mesh) a partir de una descripción en lenguaje natural, siguiendo la estructura real del proyecto. Úsala cuando el usuario pida crear un agente nuevo, un 'asistente especializado en X', un nodo para el orquestador visual, o describa un rol que debería tener su propio system prompt, permisos de lectura/escritura y tools propias — no una skill reusable entre agentes. También úsala para validar o corregir un agente existente contra la estructura de referencia. Palabras clave: agente, sanctum-agents/, nodo del mesh, permisos read_paths/write_paths, @mención, orquestador visual, cadena de agentes. No la uses si lo que se pide es un system prompt reusable sin identidad propia (usa skill-creator) ni si se pide conectar agentes ya existentes en una cadena visual (eso es configuración de chains/, fuera del alcance de esta skill)."
---

# Agent Generator (Sanctum-II)

Genera y valida definiciones de agente para `sanctum-agents/*.md`. Un agente en Sanctum-II no es solo un prompt: es una identidad con permisos propios sobre el vault, un conjunto de tools habilitadas, y un lugar potencial en el mesh de investigación o en una cadena visual. Generar un agente sin pensar en esas tres dimensiones produce un archivo que "parece" válido pero falla en runtime (por ejemplo, un agente sin `read_paths` que intenta responder con RAG y no recupera nada, porque los permisos vacíos son fail-closed).

## Cuándo aplicar esta skill y cuándo no

**Aplícala cuando:**
- El usuario pide un agente nuevo: "necesito un agente que revise gramática", "quiero un asistente que solo lea la carpeta /Legal y redacte resúmenes".
- El usuario tiene un `.md` de agente y pide validarlo, corregirlo o completar campos faltantes.
- El usuario describe un rol pensado para el mesh o el orquestador visual ("un crítico que evalúe las respuestas de Researcher").

**No la apliques cuando:**
- Lo que se pide es un system prompt reusable entre agentes sin identidad ni permisos propios → `skill-creator`.
- Lo que se pide es conectar agentes ya existentes en un flujo (`chains/`) → eso es composición visual en el orquestador, no generación de un agente nuevo. Puedes mencionar que el agente recién creado será conectable como nodo, pero no generes la cadena en sí.
- El usuario solo quiere invocar un agente existente ("@researcher investiga X") → eso es uso, no generación.

## Estructura estándar de un agente (inferida de la referencia)

> **Supuesto:** la siguiente estructura se infiere de `agente_base.md` (adjunto como referencia) y de la tabla "Agentes incluidos" + el "Ejemplo mínimo de agente" del README del proyecto. No hay un JSON Schema adjunto que la valide formalmente — si el repositorio real define uno (p. ej. en `src/agents/types.ts`), esa fuente tiene prioridad sobre esta inferencia.

```yaml
---
id: <slug-kebab-case>              # obligatorio. Identificador único, coincide con el nombre de archivo sin .md
name: "<Nombre visible>"           # obligatorio. Lo que aparece en el rail de agentes de la UI
avatar: "<emoji>"                  # opcional. Ícono en el rail de agentes; omítelo si el agente es interno/no seleccionable por el usuario
model: "<id-de-modelo>"            # opcional. Solo inclúyelo si el usuario pide explícitamente un modelo distinto al default del proyecto — por defecto, OMÍTELO y el agente hereda el modelo configurado a nivel de proyecto/Sanctum
description: "<rol del agente>"    # obligatorio. Describe qué hace el agente, no cómo (eso va en el cuerpo)
triggers:                          # opcional. Cómo se invoca el agente además de selección manual en el rail
  - type: "mention"                #   "mention" = @nombre-agente en el chat
permissions:
  read_paths: ["<glob>", ...]      # obligatorio como clave, puede ser [] — fail-closed si está vacío o ausente
  write_paths: ["<glob>", ...]     # obligatorio como clave, puede ser [] — fail-closed si está vacío o ausente
tools: [tool_a, tool_b]            # obligatorio como clave, puede ser [] para agentes puramente evaluadores (p. ej. Critic)
---
Cuerpo en Markdown: system prompt completo del agente.
```

### Campos y su función real en el runtime

| Campo | Obligatorio | Efecto en runtime |
|---|---|---|
| `id` | Sí | Nombre de archivo y referencia interna (`@id` en el chat, nodos del orquestador) |
| `name` | Sí | Texto visible en el rail de agentes y en el selector de nodos |
| `avatar` | No | Solo cosmético. Omítelo en agentes internos (ver `critic`, `orchestrator` en el README — visibilidad "Interno", sin avatar propio documentado) |
| `model` | No | Si se omite, el agente usa el modelo default del proyecto. Decláralo explícitamente solo si el usuario pide un modelo distinto por razones concretas (costo, latencia, capacidad específica) |
| `description` | Sí | Aparece en el rail/catálogo de agentes; no forma parte del prompt que el modelo recibe |
| `triggers` | No | Sin este bloque, el agente solo se invoca por selección manual en el rail o como nodo de una cadena. `type: "mention"` habilita `@id` en el chat |
| `permissions.read_paths` | Sí (como clave) | Determina qué puede leer RAG para este agente. **Vacío = el agente no recupera nada del vault**, aunque declare `rag_query` en `tools` |
| `permissions.write_paths` | Sí (como clave) | Determina dónde puede escribir/actualizar notas. Vacío = el agente no puede crear ni modificar notas, aunque declare `create_note`/`append_to_note` |
| `tools` | Sí (como clave) | Lista de capacidades habilitadas: `rag_query`, `web_search`, `create_note`, `append_to_note`. Una tool listada sin el permiso correspondiente (p. ej. `create_note` con `write_paths: []`) es una tool que fallará al usarse — evita esa combinación |

**Regla dura de coherencia:** nunca generes un agente con una `tool` que dependa de un permiso vacío. Si el usuario pide un agente de "solo lectura", `create_note`/`append_to_note` deben estar ausentes de `tools`, no solo protegidos por `write_paths: []` — la ausencia en `tools` comunica intención, el permiso vacío es solo el candado.

## Flujo paso a paso

### 1. Extrae la intención de la descripción del usuario

De la petición en lenguaje natural, identifica:

1. **Rol.** ¿Qué hace este agente que ningún otro agente existente hace? Si la respuesta es "lo mismo que Agente Base pero con otro nombre", probablemente no necesita ser un agente nuevo.
2. **Alcance de lectura.** ¿Sobre qué carpetas del vault opera? Traduce a glob concreto (`/Legal/**`, `/Research/**`, `/**` si es de propósito general). Si el usuario no lo especifica, pregunta — no asumas `/**` por defecto, porque eso amplía el acceso silenciosamente.
3. **Alcance de escritura.** ¿Puede crear o modificar notas? Si no se menciona explícitamente, asume que NO (`write_paths: []`) — es la opción fail-closed y coherente con el modelo de seguridad del proyecto.
4. **Tools necesarias.** ¿Necesita RAG (`rag_query`)? ¿Búsqueda web (`web_search`)? ¿Escribir notas (`create_note`, `append_to_note`)? Un agente puramente evaluador (tipo `critic`) puede no necesitar ninguna.
5. **Visibilidad y disparo.** ¿Es un agente que el usuario selecciona/menciona directamente, o uno interno que solo participa en un mesh/cadena? Los agentes internos (ver `critic`, `orchestrator` en el README) típicamente no necesitan `avatar` llamativo y pueden omitir `triggers` de mención si nunca se invocan por `@`.
6. **Rol en el mesh (si aplica).** ¿Este agente reemplaza o complementa a Forager/Researcher/Critic? ¿Debería poder conectarse como nodo en una cadena visual? Esto no cambia el frontmatter, pero sí condiciona qué tan genérico o especializado debe ser el cuerpo del prompt.

Si 2 o 3 quedan ambiguos después de leer la petición, pregunta antes de generar — un agente con permisos mal inferidos es un riesgo de seguridad silencioso, no un detalle menor a corregir después.

### 2. Redacta el frontmatter

Sigue la tabla de campos de arriba. Reglas rápidas:

- `id`: kebab-case, sin espacios, coincide con el nombre de archivo.
- `description`: una frase sobre el rol, no sobre el comportamiento detallado (eso va en el cuerpo). Compárala con las de la tabla "Agentes incluidos" del README (`"Recolección y reformulación de contexto."`, `"Investigación extensa con fuentes internas y web."`) — son cortas y describen función, no personalidad.
- `permissions`: nunca omitas las claves `read_paths`/`write_paths` aunque estén vacías — omitir la clave completa es distinto (y más frágil) que declararla vacía explícitamente, y hace más difícil auditar el archivo a simple vista.
- `tools`: solo las que el cuerpo del prompt efectivamente usa e instruye. No declares `web_search` "por si acaso".

### 3. Redacta el cuerpo (system prompt)

El cuerpo de un agente cumple una función distinta al cuerpo de una skill: define la **identidad persistente** del agente, independientemente de qué skill se le asigne en un turno dado. Estructura recomendada:

1. **Rol en una frase**, coherente con `description` pero más específico sobre el estilo de respuesta esperado.
2. **Reglas de contenido**: qué debe caracterizar toda respuesta de este agente, sin importar la skill activa (especificidad, tono, nivel de detalle esperado).
3. **Reglas de fuentes y citas**, si el agente tiene `rag_query` y/o `web_search` en `tools` — mismo estándar que en skills: nunca narrar el origen ("tu vault", "el contexto recuperado"), citar en línea con `[[wikilink]]`, no crear secciones por origen de dato.
4. **Caso sin información disponible**: qué hacer si el contexto recuperado está vacío. `agente_base.md` lo resuelve bien: responder en una frase y ofrecer conocimiento general marcado como tal, no como si viniera de una fuente.
5. **Variables de contexto** al final: `{{rag_context}}` y `{{user_prompt}}` son las que aparecen en la referencia; añade `{{web_context}}` solo si `web_search` está en `tools`.

**Diferencia clave con una skill:** el cuerpo de un agente no debería asumir un formato de salida único y rígido (eso es trabajo de la skill que el usuario active). El agente define personalidad y reglas de fuente; la skill, cuando se invoca, puede sobreescribir o refinar el formato específico de esa respuesta.

### 4. Valida contra la estructura de referencia

Antes de entregar, compara el resultado contra `agente_base.md` campo por campo:

- ¿Tiene `id`, `name`, `description`? Si falta alguno, el agente es inválido — complétalo, no lo entregues incompleto.
- ¿Tiene `permissions.read_paths` y `permissions.write_paths` como claves explícitas, aunque sea con arrays vacíos?
- ¿Tiene `tools` como clave (aunque sea `[]`)?
- ¿Cada tool en `tools` tiene instrucción correspondiente en el cuerpo? (misma regla que en skills — una tool declarada y no usada en el prompt es señal de un agente a medio especificar)
- ¿El cuerpo evita narrar el origen de la información?
- ¿`model` está ausente, salvo pedido explícito del usuario?
- ¿`avatar` está presente solo si el agente es de cara al usuario?

Si algo falta, señálalo explícitamente al usuario en vez de rellenarlo con un valor inventado — por ejemplo: "Tu descripción no especifica si este agente puede escribir notas; asumí `write_paths: []` (solo lectura) porque es la opción segura por defecto. Confírmame si necesita permiso de escritura."

### 5. Anti-patrones a evitar

| Anti-patrón | Por qué falla | Corrección |
|---|---|---|
| Omitir `read_paths`/`write_paths` completamente en vez de declararlos vacíos | Ambiguo entre "no lo pensé" y "intencionalmente sin acceso"; dificulta auditoría | Declara siempre ambas claves, con `[]` si corresponde |
| Declarar `tools: [create_note]` con `write_paths: []` | La tool fallará en cuanto se invoque — combinación inconsistente | O agregas `write_paths` real, o quitas `create_note` de `tools` |
| Agregar `model` por costumbre, copiando `agente_base.md` sin que el usuario lo haya pedido | Acopla el agente a un modelo específico sin razón declarada; dificulta cambios de proveedor a nivel proyecto | Omite `model` salvo pedido explícito y justificado |
| `permissions.read_paths: ["/**"]` por defecto sin que el usuario lo haya confirmado | Amplía el acceso del agente a todo el vault silenciosamente | Pregunta el alcance real; usa el glob más restrictivo que cumpla el caso de uso descrito |
| Cuerpo del agente que fija un formato de salida rígido (tipo "siempre responde en 5 viñetas") | Confunde el rol de agente con el rol de skill; impide que distintas skills definan formatos distintos sobre el mismo agente | Deja el formato de salida a las skills; el agente define identidad, fuentes y tono |
| Generar `avatar` con emoji para un agente descrito como "interno" o "solo para el mesh" | Sugiere visibilidad en el rail de agentes que no corresponde | Omite `avatar` y `triggers.mention` para agentes internos, según el patrón de `critic`/`orchestrator` en el README |

### 6. Checklist de pre-entrega

- [ ] `id` coincide con el nombre de archivo, kebab-case.
- [ ] `name` y `description` presentes y coherentes entre sí.
- [ ] `permissions.read_paths` y `permissions.write_paths` declarados explícitamente (array vacío si corresponde, nunca omitidos).
- [ ] `tools` declarado explícitamente (array vacío si el agente no usa ninguna).
- [ ] Cada tool en `tools` tiene una combinación de permisos coherente (ninguna tool "fantasma" que fallará al invocarse).
- [ ] Cada tool en `tools` tiene instrucción correspondiente en el cuerpo.
- [ ] `model` ausente, salvo pedido explícito del usuario (y en ese caso, está justificado).
- [ ] `avatar` presente solo si el agente es seleccionable por el usuario en la UI; ausente si es interno.
- [ ] `triggers` con `type: "mention"` presente solo si el agente debe responder a `@id` en el chat.
- [ ] El cuerpo define rol, reglas de fuente/cita (si aplica) y caso sin información disponible.
- [ ] El cuerpo NO fija un formato de salida rígido que debería vivir en una skill.
- [ ] Cualquier campo inferido sin confirmación explícita del usuario está señalado como supuesto en la respuesta final.

## Ejemplo completo, de principio a fin

**Petición del usuario:** "Quiero un agente que solo lea la carpeta /Legal del vault, no pueda escribir nada, y responda preguntas legales citando siempre la nota exacta. Que se pueda invocar con @legal."

**Aplicando el flujo:**

1. **Extracción de intención:**
   - Rol: responder preguntas sobre contenido legal del vault.
   - Lectura: `/Legal/**` (glob explícito, no `/**`).
   - Escritura: ninguna mencionada → `write_paths: []`.
   - Tools: solo `rag_query` (no se pidió web ni escritura).
   - Visibilidad: de cara al usuario, invocable por `@legal` → sí necesita `avatar` y `triggers`.
   - Rol en el mesh: no mencionado, se asume agente de uso directo (no interno).

2. **Frontmatter y cuerpo resultantes** (`sanctum-agents/legal.md`):

```markdown
---
id: legal
name: "Legal"
avatar: "⚖️"
description: "Responde preguntas sobre contenido legal del vault, limitado a la carpeta /Legal, citando siempre la nota exacta."
triggers:
  - type: "mention"
permissions:
  read_paths: ["/Legal/**"]
  write_paths: []
tools: [rag_query]
---
Eres un asistente especializado en el contenido legal indexado en /Legal. Respondes con precisión y sin especular más allá de lo que las notas afirman explícitamente.

REGLAS DE CONTENIDO
- Responde siempre citando la nota exacta que respalda cada afirmación. Si una afirmación no tiene respaldo directo en el contexto recuperado, dilo explícitamente en vez de completar con supuestos.
- No narres el proceso de búsqueda ni escribas "según tu vault" o "el contexto recuperado indica". La cita ya comunica el origen.
- Sé preciso con fechas, números de artículo, nombres de documentos y cláusulas cuando el contexto los incluya.

CITAS
- Cada afirmación relevante cierra con [[wikilink]] a la nota fuente.
- Si el contexto recuperado está vacío, responde en una sola frase indicando que no hay contenido en /Legal para esa consulta, y ofrece tu conocimiento general marcándolo explícitamente como tal (no como fuente del vault).

Contexto disponible:
{{rag_context}}

Pregunta del usuario:
{{user_prompt}}
```

3. **Validación contra la referencia:** `id`/`name`/`description` presentes; `permissions` con ambas claves explícitas (`read_paths` restringido a `/Legal/**`, `write_paths` vacío coherente con "no pueda escribir nada"); `tools: [rag_query]` con instrucción correspondiente en el cuerpo; `model` ausente (no se pidió); `avatar` y `triggers.mention` presentes porque el usuario pidió invocación por `@legal`; el cuerpo no fija formato de salida rígido, solo reglas de fuente y precisión — el formato específico queda abierto a que el usuario active una skill sobre este agente si lo necesita.

4. **Nota al usuario en la entrega:** "Asumí que 'no pueda escribir nada' significa `write_paths: []` sin excepciones, y que la ausencia de mención a búsqueda web implica que este agente no debe salir de /Legal. Si más adelante necesita contrastar con fuentes externas, se le puede agregar `web_search` a `tools` sin tocar el resto del archivo."
