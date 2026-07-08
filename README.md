# Sanctum-II — MVP (Fase 0)

> Plugin de Obsidian: plataforma autocontenida de agentes de IA que razonan sobre tu vault.
> **Esta es la Fase 0** — un recorte deliberado del diseño completo, no el producto final. Ver [¿Qué es esto realmente?](#qué-es-esto-realmente) antes de esperar funcionalidad que no está acá todavía.

---

## Qué es esto realmente

Sanctum-II es, en su versión final, una plataforma de **mesh de agentes** (varios agentes especializados colaborando en loops de investigación/crítica/regeneración, con Knowledge Graph semántico, memoria por proyecto, y sistema de skills). Esta fase **no es eso**.

Esta fase (Fase 0 / MVP) existe para responder una sola pregunta antes de construir nada más complejo: **¿el contrato entre runtime de agentes, RAG y orquestador funciona de punta a punta?**

Concretamente, lo que hay acá es:

- **Un único agente fijo** (`@agente_base`), sin mesh.
- **RAG simple** sobre una sola carpeta del vault (no el vault completo).
- **Un orquestador mínimo** que rutea RAG → permisos → agente → respuesta, sin loops ni reintentos.
- **Observabilidad completa desde el día uno** — cada ejecución queda trazada.

Si estás buscando `@forager`, `@researcher`, `@critic`, el Knowledge Graph, memoria persistente, o Skills — no están en esta fase todavía. Ver [Qué NO incluye esta fase](#qué-no-incluye-esta-fase).

## Por qué existe este recorte

Agregar todo el sistema de una vez hace imposible saber, cuando algo falla, si el problema está en el runtime, en el RAG, en el orquestador, o en la interacción entre los tres. Esta fase reduce la superficie a lo mínimo indispensable para validar ese contrato con un solo agente, antes de escalar a un mesh de varios.

Si en algún punto de esta fase surge la tentación de "ya que estoy, agrego el segundo agente" — **no**. Eso invalida la validación que esta fase existe para hacer. Ver la sección 2 de [`Sanctum-II-MVP.md`](./Sanctum-II-MVP.md) para el razonamiento completo.

---

## Qué SÍ incluye esta fase

| Pieza | Alcance en esta fase |
|---|---|
| Runtime de agentes | Un único agente fijo, definido en `.md` |
| RAG | Una sola carpeta indexada, contexto inyectado por similitud |
| Orquestador | Prompt → ¿necesita RAG? → invoca agente → devuelve resultado |
| Permisos | Filtro de `read_paths` ya activo (mismo mecanismo que usará el sistema completo) |
| Observabilidad | Logging completo por `trace_id`: prompt exacto, contexto inyectado, chunks recuperados, duración |

## Qué NO incluye esta fase

Pospuesto deliberadamente, no olvidado — cada ítem ya está diseñado en el documento maestro y se construye después, no en paralelo:

- Mesh de múltiples agentes (`@forager` → `@researcher` → `@critic`)
- Loop de reintentos con score/threshold de evaluación
- Knowledge Graph (ni el nativo de Obsidian ni la capa semántica)
- Sistema de Skills (personales/generales)
- Memoria persistente por proyecto entre sesiones
- UI estilo Notion (paneles, dropdowns, selector `@`) — esta fase se valida por CLI o una caja de texto mínima

---

## Arquitectura de esta fase

```
┌─────────────────────────────────────────────────────┐
│                    VAULT (.md)                        │
│         UNA sola carpeta indexada (ej. /Research/)     │
└───────────────────────┬───────────────────────────────┘
                         │
                         ▼
                ┌─────────────────┐
                │   RAG SIMPLE     │  ← sqlite-vss u orama,
                │  (chunk + embed) │     full reindex manual
                └────────┬─────────┘
                         ▼
                ┌─────────────────┐
                │ filtro permisos  │  ← read_paths, mismo mecanismo
                │  (read_paths)    │     que usará el sistema completo
                └────────┬─────────┘
                         ▼
                ┌─────────────────┐
                │  ORQUESTADOR     │  ← versión mínima, sin loop
                │  (mínimo)        │
                └────────┬─────────┘
                         ▼
                ┌─────────────────┐
                │  @agente_único   │  ← sin Forager/Researcher/Critic
                └────────┬─────────┘
                         ▼
                ┌─────────────────┐
                │  OBSERVABILIDAD  │  ← trace_id + log completo
                │  /sanctum-logs/  │
                └─────────────────┘
```

Detalle completo de cada pieza en [`Sanctum-II-MVP.md`](./Sanctum-II-MVP.md), secciones 3-7.

---

## Estructura del repo

```
/sanctum-agents/
  └── agente_base.md          # definición del único agente de esta fase

/sanctum-logs/
  └── traces/
        └── trace_<timestamp>_<id>.jsonl   # un archivo por ejecución

/Sanctum-II-Vision.md          # diseño completo del sistema final (referencia)
/Sanctum-II-MVP.md             # especificación detallada de esta fase
/README.md                     # este archivo
```

---

## Cómo probarlo

1. Colocá algunas notas `.md` en una carpeta `/Research/` de un vault de prueba.
2. Corré la indexación (RAG simple, manual por ahora — no hay incremental todavía en esta fase).
3. Hacele una pregunta a `@agente_base` sobre el contenido de esas notas.
4. Verificá que el orquestador rutee correctamente: RAG → filtro de permisos → agente → respuesta.
5. Confirmá que la respuesta use el contenido real de las notas, no conocimiento genérico del modelo.
6. Abrí `/sanctum-logs/traces/` y revisá el trace de esa ejecución: prompt exacto, chunks recuperados con su score, y respuesta final.

Si los 6 puntos funcionan, el criterio de éxito de esta fase está cumplido — ver sección 8 de [`Sanctum-II-MVP.md`](./Sanctum-II-MVP.md) para el detalle exacto de cada verificación.

---

## Definición del agente de esta fase

```yaml
---
id: agente_base
name: "Agente Base"
avatar: "🤖"
model: "claude-sonnet-5"
description: "Agente único de validación del runtime — responde preguntas usando contexto del RAG"
triggers:
  - type: "mention"
tools:
  - rag_query
permissions:
  read_paths: ["/Research/**"]
  write_paths: []
---
Eres un asistente que responde preguntas del usuario utilizando
el contexto que se te provee del vault. Si el contexto no contiene
información relevante, decilo explícitamente en vez de inventar.
```

Este es el formato **definitivo** de agente — no una versión de prueba. Se reusa tal cual cuando se agreguen `@forager`, `@researcher`, `@critic` y agentes custom en fases posteriores.

---

## Observabilidad — qué esperar

Cada ejecución escribe un trace completo, con texto íntegro (no resumido ni hasheado) de cada prompt y contexto inyectado:

```yaml
trace_id: "trace_2026-07-07_14-32-01_a8f3"
timestamp: "2026-07-07T14:32:03Z"
type: "agent_invocation"
agent_id: "agente_base"
input:
  system_prompt: "..."
  user_prompt: "..."
  injected_context:
    - source: "rag"
      chunk: "..."
      similarity_score: 0.84
      from_note: "Research/nota-A.md"
output: "..."
duration_ms: 2340
```

Esto permite responder, desde el primer día, preguntas como "¿qué prompt recibió el agente?", "¿qué contexto inyectó el RAG?", "¿qué documentos recuperó?" — sin tener que instrumentar nada extra más adelante. Detalle completo en la sección 7 de [`Sanctum-II-MVP.md`](./Sanctum-II-MVP.md).

---

## Qué se lleva sin cambios a las fases siguientes

| Elemento de esta fase | ¿Se reusa tal cual en el sistema completo? |
|---|---|
| Formato `.md`/YAML del agente | Sí — es el formato definitivo |
| Filtro de permisos (`read_paths`) | Sí — mismo mecanismo, se aplicará a más agentes |
| Shape de `loop_state` | Sí — se extiende con más campos, no se reescribe |
| Formato de trace de observabilidad | Sí — mismo shape, se agregan más `type` de evento |
| RAG con una sola carpeta fija | No — se generaliza a indexar el vault completo |
| Orquestador sin loop de reintentos | No — se extiende con score/threshold/regeneración |

---

## Próximos pasos (fuera del alcance de esta fase)

Una vez que el criterio de éxito de esta fase esté validado, el orden de escalado ya está definido en la sección 11 de [`Sanctum-II-Vision.md`](./Sanctum-II-Vision.md):

1. Agregar `@forager` y `@researcher` como segundo agente del mesh
2. Orquestador completo + `@critic` + loop con threshold de evaluación
3. Knowledge Graph semántico encima del grafo nativo de Obsidian
4. Memoria persistente por proyecto
5. Sistema de Skills (personales y generales)

No se debe adelantar ninguno de estos pasos dentro del alcance de esta fase.

---

## Documentación de referencia

- [`Sanctum-II-Vision.md`](./Sanctum-II-Vision.md) — diseño completo del sistema final: arquitectura, mesh de agentes, Knowledge Graph, memoria, skills, y mapa de decisiones cerradas.
- [`Sanctum-II-MVP.md`](./Sanctum-II-MVP.md) — especificación detallada de esta fase: qué entra, qué no, y por qué.

Cualquier decisión tomada en esta fase que contradiga algo ya cerrado en `Sanctum-II-Vision.md` es un error a corregir, no una nueva decisión.