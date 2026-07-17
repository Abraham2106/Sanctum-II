<a id="readme-top"></a>

<div align="center">
  <a href="https://github.com/Abraham2106/Sanctum-II">
    <img src="docs/logo.png" alt="Logo de Sanctum II" width="128">
  </a>

  <h1>Sanctum II</h1>

  <p>
    Plataforma local-first de agentes de IA para investigar, organizar y convertir un vault de Obsidian en conocimiento reutilizable.
  </p>

  <p>
    <a href="https://github.com/Abraham2106/Sanctum-II/graphs/contributors"><img alt="Contribuidores" src="https://img.shields.io/github/contributors/Abraham2106/Sanctum-II?style=flat-square"></a>
    <a href="https://github.com/Abraham2106/Sanctum-II/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Abraham2106/Sanctum-II?style=flat-square"></a>
    <a href="https://github.com/Abraham2106/Sanctum-II/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Abraham2106/Sanctum-II?style=flat-square"></a>
    <a href="https://github.com/Abraham2106/Sanctum-II/issues"><img alt="Issues" src="https://img.shields.io/github/issues/Abraham2106/Sanctum-II?style=flat-square"></a>
    <a href="https://github.com/Abraham2106/Sanctum-II/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Abraham2106/Sanctum-II/ci.yml?branch=main&style=flat-square&label=CI"></a>
    <a href="https://github.com/Abraham2106/Sanctum-II/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Abraham2106/Sanctum-II?style=flat-square"></a>
    <a href="LICENSE"><img alt="Licencia MIT" src="https://img.shields.io/github/license/Abraham2106/Sanctum-II?style=flat-square"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white">
    <img alt="Obsidian Desktop" src="https://img.shields.io/badge/Obsidian-Desktop-7C3AED?style=flat-square&logo=obsidian&logoColor=white">
    <img alt="MCP" src="https://img.shields.io/badge/MCP-stdio-24292F?style=flat-square">
  </p>

  <p>
    <a href="#inicio-rápido"><strong>Inicio rápido</strong></a>
    ·
    <a href="docs/objetivos-y-casos-de-uso.md"><strong>Objetivos y casos de uso</strong></a>
    ·
    <a href="mcp-server/README.md"><strong>Servidor MCP</strong></a>
    ·
    <a href="https://github.com/Abraham2106/Sanctum-II/issues/new?labels=bug&amp;title=%5BBug%5D%3A%20"><strong>Reportar un error</strong></a>
    ·
    <a href="https://github.com/Abraham2106/Sanctum-II/issues/new?labels=enhancement&amp;title=%5BFeature%5D%3A%20"><strong>Solicitar una función</strong></a>
  </p>
</div>

> [!IMPORTANT]
> Sanctum II está en desarrollo activo (`v0.1.0`) y funciona únicamente en Obsidian Desktop. Antes de usarlo con información sensible, revisa la sección de [seguridad y privacidad](#seguridad-y-privacidad).

<details>
  <summary><strong>Tabla de contenidos</strong></summary>

- [Visión general](#visión-general)
  - [Contrato de objetivos](#contrato-de-objetivos)
  - [Construido con](#construido-con)
- [Capacidades principales](#capacidades-principales)
- [Experiencia del producto](#experiencia-del-producto)
- [Cómo funciona](#cómo-funciona)
- [Inicio rápido](#inicio-rápido)
- [Primer uso](#primer-uso)
- [Flujos de trabajo](#flujos-de-trabajo)
- [Proyectos y almacenamiento](#proyectos-y-almacenamiento)
- [Recuperación y Knowledge Graph](#recuperación-y-knowledge-graph)
- [Agentes y skills](#agentes-y-skills)
- [Creación asistida de agentes y skills](#creación-asistida-de-agentes-y-skills)
- [Servidor MCP](#servidor-mcp)
- [Seguridad y privacidad](#seguridad-y-privacidad)
- [Desarrollo y calidad](#desarrollo-y-calidad)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Estado y roadmap](#estado-y-roadmap)
- [Contribuir](#contribuir)
- [Soporte y feedback](#soporte-y-feedback)
- [Licencia](#licencia)
- [Agradecimientos](#agradecimientos)

</details>

## Visión general

Sanctum II integra chat, recuperación semántica, agentes especializados, proyectos aislados y escritura controlada de notas dentro de Obsidian. El contenido y el estado operativo permanecen en el vault: proyectos, threads, memoria, índices, trazas, agentes, skills y cadenas se almacenan como Markdown o JSONL inspeccionable.

La plataforma ofrece dos superficies sobre el mismo conocimiento:

- **Plugin de Obsidian:** experiencia visual para conversar, investigar, administrar proyectos, explorar el Knowledge Graph y diseñar cadenas de agentes.
- **Servidor MCP standalone:** proceso Node sobre `stdio` que permite consultar el vault e invocar agentes desde VS Code, OpenCode y otros clientes compatibles, incluso sin Obsidian abierto.

### Contrato de objetivos

Sanctum II convierte notas propias y papers Markdown en una base de conocimiento operativa para proyectos de programación. La hackathon de computación cuántica que motivó el proyecto es su primer caso de referencia, no un límite: proyectos, corpus, agentes y skills permiten cambiar de dominio sin modificar el núcleo.

Los ocho objetivos medibles, su matriz de trazabilidad, criterios de aceptación, casos de uso y no-objetivos se mantienen en [Objetivos y casos de uso](docs/objetivos-y-casos-de-uso.md), la fuente canónica para acoplar nuevas funcionalidades.

### Por qué existe Sanctum II

Un chat genérico puede responder preguntas, pero normalmente desconoce cómo está organizado un vault, qué carpetas puede leer, dónde debe escribir y qué conversación pertenece a cada proyecto. Sanctum II añade esa capa operativa:

- **El contexto tiene límites:** cada proyecto y agente declara las rutas que puede consultar o modificar.
- **La investigación deja un artefacto:** una respuesta puede transformarse en una nota Markdown autónoma, con fórmulas, citas y referencias conservadas.
- **Los flujos son inspeccionables:** prompts, agentes, skills, proyectos, índices y trazas se guardan en formatos abiertos.
- **La interfaz no encierra el conocimiento:** el mismo vault puede utilizarse desde Obsidian o desde clientes externos mediante MCP.
- **La crítica forma parte del proceso:** el mesh no se limita a encadenar respuestas; evalúa el resultado y puede pedir una regeneración antes de entregarlo.

### Construido con

| Tecnología | Papel en Sanctum II |
|---|---|
| [Obsidian](https://obsidian.md) | Superficie de escritorio y API del plugin. |
| [TypeScript](https://www.typescriptlang.org) | Código fuente del plugin y del servidor MCP. |
| [Node.js](https://nodejs.org) | Runtime de desarrollo y del servidor MCP standalone. |
| [esbuild](https://esbuild.github.io) | Bundles de producción y modo watch. |
| [Vitest](https://vitest.dev) | Pruebas automatizadas. |
| [Google Gemini](https://ai.google.dev) | Embeddings para RAG y búsqueda semántica. |
| [OpenCode](https://opencode.ai) | Proveedor configurable para las respuestas LLM. |
| [Tavily](https://tavily.com) | Búsqueda web opcional para investigación profunda. |

## Capacidades principales

| Área | Capacidad |
|---|---|
| **Chat contextual** | Conversaciones persistentes, resumen progresivo, menciones `@agente` y continuidad al crear notas desde una investigación previa. |
| **RAG por proyecto** | Índices vectoriales independientes, filtros por `read_paths`, manifiesto incremental y reindexado total o parcial. |
| **Mesh de investigación** | Pipeline Forager → Researcher ↔ Critic con evaluación, feedback, regeneración y escalado. |
| **Proyectos** | Threads, memoria, archivos adjuntos, instrucciones, rutas de lectura/escritura y carpeta de salida propias. |
| **Knowledge Graph** | Relaciones por wikilinks, similitud semántica y refuerzo de conexiones. |
| **Notas accionables** | Creación y actualización de Markdown con permisos fail-closed y registro de la ruta realmente escrita. |
| **Extensibilidad declarativa** | Agentes y skills en Markdown con frontmatter YAML, tools, placeholders y permisos explícitos. |
| **Agent Creator** | Modal guiado para generar, revisar, validar y guardar agentes con iconos Lucide y una skill complementaria opcional. |
| **Skill Creator** | Mesh contextual RAG → web → autor → crítico, con quality gate, regeneración y actualización con historial. |
| **Cadenas visuales** | Composición y ejecución de flujos dirigidos de agentes desde Obsidian. |
| **MCP** | Seis tools para listar agentes, leer notas, consultar RAG, validar QUBO/Ising, invocar agentes y ejecutar el mesh. |
| **Observabilidad** | Trazas JSON con origen, agente, duración, uso y estado de la ejecución. |

## Experiencia del producto

Sanctum II se divide en vistas especializadas. Cada una expone una parte del runtime sin obligar al usuario a editar archivos internos para las tareas habituales.

### Chat: conversación, contexto y observabilidad

![Vista de chat de Sanctum II](docs/MVP-Chat.png)

La vista principal está organizada en tres áreas:

1. **Rail de agentes:** permite cambiar entre Forager, Researcher, Agente Base y agentes personalizados. También expone identidad, system prompt, contexto RAG, permisos e índice activo.
2. **Conversación:** contiene el thread del proyecto, el selector Chat/Mesh, menciones con `@`, selección de skills y controles de indexación.
3. **Trace y fuentes:** muestra la ejecución más reciente y las notas que aportaron contexto, haciendo visible qué ocurrió detrás de una respuesta.

El chat no es stateless. Cada conversación mantiene mensajes, resumen progresivo, notas creadas y acciones pendientes. Esto permite que una instrucción como _“crea una nota con esta investigación”_ reutilice la respuesta completa del turno anterior aunque el agente explícito ya no aparezca en el mensaje.

### Orquestador visual: agentes como un flujo ejecutable

![Orquestador visual Forager, Researcher y Critic](docs/MVP-Mesh.png)

El canvas permite construir cadenas conectando nodos de agentes. En la captura, Forager prepara las fuentes, Researcher desarrolla el análisis y Critic revisa el resultado.

- Los nodos se arrastran desde el catálogo lateral.
- Los puertos conectan la salida de un agente con la entrada del siguiente.
- Las cadenas pueden abrirse, guardarse, reorganizarse y ejecutarse.
- El orden se valida topológicamente antes de iniciar el flujo.
- Una cadena guardada puede invocarse desde el chat mediante `@nombre-de-cadena`.

Además de estas cadenas configurables, Sanctum incluye un mesh de investigación predefinido con ciclo de crítica: si el resultado no alcanza el umbral de aceptación, Researcher recibe feedback y regenera la respuesta hasta el límite de intentos.

### Proyectos: aislamiento de conocimiento y trabajo

![Vista de proyectos de Sanctum II](docs/MVP-Proyectos.png)

La vista de proyectos concentra el estado que antes quedaba disperso entre carpetas y conversaciones:

- **Panel izquierdo:** selector de proyectos y creación de nuevos espacios.
- **Área central:** conversaciones persistentes y acceso directo al chat dentro del contexto elegido.
- **Panel derecho:** instrucciones, carpetas autorizadas, configuración RAG, memoria persistente y archivos adjuntos.

Cambiar de proyecto cambia también el índice vectorial, las rutas permitidas, la memoria, los threads y la carpeta de salida. El índice global histórico no se mezcla con los índices aislados cuando el modo de proyectos está habilitado.

## Cómo funciona

```text
Usuario / cliente MCP
        │
        ├── Chat directo ──► ChatOrchestrator ──► agente + skill
        │                                           │
        ├── Mesh ──────────► Forager ─► Researcher ◄┤
        │                                  │        │
        │                               Critic ─────┘
        │
        └── Contexto del proyecto
              ├── read_paths / write_paths
              ├── VectorStore + manifiesto
              ├── Knowledge Graph
              ├── memoria + thread + resumen
              └── salida Markdown
```

El flujo general de una consulta es:

1. Capturar un snapshot del proyecto, thread, agente, skill e índices activos.
2. Resolver confirmaciones o acciones pendientes de la conversación.
3. Aplicar permisos y filtros de rutas.
4. Recuperar contexto RAG y, cuando corresponde, contexto web.
5. Ejecutar el agente o el mesh.
6. Persistir resumen, acciones pendientes, notas creadas y trazas.

Consulta [registro-arquitectura.md](docs/registro-arquitectura.md) y [arquitectura-uml.md](docs/arquitectura-uml.md) para una descripción más detallada.

## Inicio rápido

### Requisitos

- Obsidian Desktop `1.0.0+`.
- Node.js `22` recomendado y npm.
- Una API key compatible con OpenCode para las respuestas LLM.
- Una o más API keys de Gemini para embeddings y RAG.
- Opcionalmente, una API key de Tavily para búsqueda web.

### 1. Clonar e instalar

```bash
git clone https://github.com/Abraham2106/Sanctum-II.git
cd Sanctum-II
npm install
```

### 2. Configurar credenciales

Las credenciales pueden configurarse desde **Settings → Sanctum II** o mediante un archivo `.env` basado en `.env.example`:

```env
OPENCODE_GO_API_KEY=sk-tu-api-key
OPENCODE_GO_BASE_URL=https://api.opencode.ai
GEMINI_API_KEYS=your-gemini-api-key-1,your-gemini-api-key-2
TAVILY_API_KEY=tvly-tu-api-key
```

`TAVILY_API_KEY` es opcional para los flujos que no usan la web. El comando `/skill-creator` sí la requiere porque contrasta el contexto local con fuentes públicas antes de redactar y evaluar una skill.

> [!CAUTION]
> No publiques `.env`, keys reales ni configuraciones MCP con secretos embebidos. Prefiere variables del entorno del sistema.

### 3. Compilar

```bash
npm run build
```

El build produce:

- `main.js`, bundle del plugin de Obsidian.
- `mcp-server/dist/index.cjs`, servidor MCP standalone.

### 4. Instalar en un vault

Crea `.obsidian/plugins/sanctum-ii/` dentro del vault y copia:

```text
main.js
manifest.json
styles.css
```

Copia también los directorios `sanctum-agents/` y `sanctum-skills/` en la raíz del vault. Después, recarga Obsidian y habilita **Sanctum II** en **Settings → Community plugins**.

En Windows puedes usar:

```powershell
npm run deploy
```

Antes de ejecutarlo, cambia la variable `$vault` al inicio de `deploy.ps1`; el script incluido apunta al vault local de desarrollo y no es portable sin esa modificación.

## Primer uso

1. Abre **Proyectos** desde el ribbon de Obsidian.
2. Crea o selecciona un proyecto.
3. Configura sus `read_paths`, `write_paths` y carpeta de salida.
4. Indexa el proyecto desde la vista o desde la paleta de comandos.
5. Abre el chat y consulta el contenido indexado.

Ejemplos:

```text
@researcher Investiga QAOA, Ising y QUBO /deep-research

Crea una nota en el vault con el contenido de la investigación

@mi-cadena Analiza estas fuentes y prepara una revisión crítica

@agent-creator Crea un revisor de contratos que solo lea /Legal/**

/skill-creator crea una skill para revisar implementaciones QUBO
```

Cuando un agente ofrece guardar una investigación, Sanctum conserva el contenido fuente como una acción pendiente. Una confirmación posterior puede reformatearlo como nota autónoma sin perder fórmulas, referencias ni contexto.

### Vistas y comandos disponibles

| Acción | Acceso | Resultado |
|---|---|---|
| Abrir chat | Ribbon o paleta de comandos | Abre la conversación del proyecto activo. |
| Abrir Knowledge Graph | Ribbon o paleta | Explora relaciones explícitas y semánticas. |
| Abrir Proyectos | Ribbon o paleta | Administra proyectos, threads, memoria, rutas e índice. |
| Abrir Orquestador | Ribbon o paleta | Diseña y ejecuta cadenas visuales de agentes. |
| Indexar Research | Paleta, Settings o proyecto | Actualiza el índice RAG permitido. |
| Probar embeddings | Settings o paleta | Verifica la conexión y configuración de Gemini. |
| Probar chat | Settings o paleta | Verifica OpenCode y el modelo configurado. |
| Generar nota con IA | Paleta | Crea una nota aplicando permisos y carpeta de salida. |
| Ejecutar mesh | Chat o paleta | Inicia el flujo Forager → Researcher ↔ Critic. |
| Crear agente | `@agent-creator <brief>` en el chat | Abre el modal de autoría, valida la definición y guarda el agente. |
| Crear skill | `/skill-creator <brief>` en el chat | Ejecuta el mesh de autoría y guarda únicamente una skill aprobada. |
| Actualizar skill | `/skill-creator --update <id> <cambios>` | Mejora una skill existente y archiva la versión anterior. |

## Flujos de trabajo

### Consulta directa con RAG

Usa el Agente Base para preguntas centradas en el material indexado. Sanctum genera el embedding de la consulta, recupera los chunks relevantes, aplica los filtros del proyecto y del agente, y entrega ese contexto al modelo.

```text
¿Qué limitaciones de hardware aparecen en las notas sobre quantum annealing?
```

Las respuestas pueden citar las notas mediante `[[wikilinks]]`, mientras el panel de fuentes permite inspeccionar qué documentos participaron.

### Investigación profunda

Selecciona Researcher y activa la skill `deep-research` cuando necesites contrastar el vault con información web:

```text
@researcher Compara QAOA y quantum annealing para optimización energética /deep-research
```

Forager prepara el contexto, Researcher construye el análisis y, en modo Mesh, Critic evalúa coherencia, uso de fuentes, completitud, actualidad y claridad. El umbral predeterminado de aceptación es `80/100`, con un máximo de tres intentos.

### Convertir una investigación en nota

Después de una respuesta extensa, puedes utilizar una confirmación corta o referencial:

```text
Genera la nota
Crea una nota en el vault con el contenido de la investigación
Guarda el contenido anterior
```

Sanctum utiliza el snapshot completo de la investigación como fuente, elimina el lenguaje conversacional y escribe un documento Markdown autónomo. Esta segunda operación no repite la investigación web ni sustituye el contenido por una explicación genérica.

### Modificar una nota creada

Las notas generadas se registran en el thread con su título y ruta real. Esto permite resolver instrucciones posteriores sin depender únicamente del nombre escrito por el usuario:

```text
En la nota que acabas de crear, amplía la sección de limitaciones.
```

Antes de escribir, Sanctum resuelve la referencia y vuelve a validar los `write_paths` del proyecto.

### Ejecutar desde un cliente MCP

Un cliente externo puede consultar el mismo vault sin abrir Obsidian. Por ejemplo, `sanctum_query_vault` recupera contexto semántico y `sanctum_run_mesh` ejecuta el pipeline de investigación desde VS Code u OpenCode. Las llamadas siguen utilizando el agente indicado y sus permisos de lectura.

## Proyectos y almacenamiento

Cada proyecto mantiene su propio perímetro de contexto y persistencia:

| Ruta | Contenido |
|---|---|
| `sanctum-projects/{projectId}.md` | Configuración, permisos, modelo e instrucciones del proyecto. |
| `sanctum-logs/index/{projectId}/vector-store.jsonl` | Chunks y embeddings del índice vectorial. |
| `sanctum-logs/index/{projectId}/manifest.json` | Estado incremental de archivos indexados. |
| `sanctum-logs/threads/{projectId}/` | Threads, mensajes, resúmenes y acciones pendientes. |
| `sanctum-memory/{projectId}/memory.jsonl` | Memoria persistente del proyecto. |
| `Projects/{projectId}/` | Notas generadas para el proyecto. |
| `sanctum-logs/traces/` | Trazas del plugin y del servidor MCP. |

La indexación por proyecto:

- valida que las carpetas solicitadas pertenezcan a `read_paths`;
- escucha `create`, `modify`, `delete` y `rename` de Markdown, agrupa eventos durante 1,5 segundos y reconcilia al abrir;
- serializa solicitudes concurrentes por proyecto;
- usa SHA-256 para documentos, configuración y chunks, con manifiesto `IndexManifestV2` versionado;
- produce cero embeddings para documentos intactos y reutiliza chunks idénticos solo dentro del mismo proyecto;
- conserva otras carpetas durante un reindexado parcial;
- elimina del índice archivos borrados durante un reindexado completo;
- conserva cambios pendientes si faltan credenciales de Gemini;
- inicia vacío, sin tratar la ausencia del primer índice como error.

## Recuperación y Knowledge Graph

### RAG vectorial

El indexador recorre únicamente las carpetas autorizadas del proyecto, divide las notas con un chunker que mantiene indivisibles LaTeX inline, bloques, entornos de ecuación y código, genera embeddings con Gemini y persiste transacciones compactas en JSONL. La configuración predeterminada utiliza embeddings de `768` dimensiones, chunks de hasta `400` palabras, `top_k = 5` y similitud mínima de `0.65`; cada proyecto puede ajustar estos valores.

Durante una consulta, el sistema busca candidatos en el índice activo y aplica dos filtros antes de entregar contexto al modelo:

1. Las rutas de lectura del proyecto o filtro seleccionado.
2. Los `read_paths` declarados por el agente.

Esto evita que cambiar de agente amplíe implícitamente su acceso al contenido.

### Grafo de conocimiento

El Knowledge Graph combina tres señales:

- **Explícita:** enlaces `[[wikilink]]` ya presentes en las notas.
- **Semántica:** similitud entre embeddings de notas o chunks relacionados.
- **Reforzada:** conexiones que reciben mayor peso cuando diferentes señales coinciden.

La vista permite activar y desactivar tipos de arista, ajustar el umbral semántico y explorar vecinos relacionados. Los eventos de modificación y eliminación del vault actualizan las relaciones asociadas para reducir referencias obsoletas.

## Agentes y skills

Los agentes viven en `sanctum-agents/*.md` y las skills en `sanctum-skills/*.md`. Ambos usan frontmatter declarativo.

### Agentes incluidos

| ID | Rol | Tools declaradas | Visibilidad |
|---|---|---|---|
| `agente_base` | Chat general, RAG y acciones sobre notas. | `rag_query`, `create_note`, `append_to_note` | Usuario |
| `forager` | Recolección y reformulación de contexto. | `rag_query` | Usuario |
| `researcher` | Investigación extensa con fuentes internas y web. | `rag_query`, `web_search` | Usuario |
| `critic` | Evaluación estructurada y feedback del mesh. | Ninguna | Interno |
| `web-search` | Consulta web y síntesis contextual. | `web_search`, `rag_query` | Usuario |
| `orchestrator` | Clasificación de intención para mensajes implícitos. | Ninguna | Interno |
| `agent-creator` | Punto de entrada para crear y validar agentes desde el chat. | Ninguna | Usuario |
| `boilerplate-agent` | Definición de referencia para agentes basados en RAG. | `rag_query` | Interno |
| `qc-programmer` | Programación QAOA/QUBO/Ising con auto-chequeo previo a la entrega. | `rag_query`, `sanctum_validate_qubo` | Usuario |
| `skill-context-analyst` | Extrae convenciones y vacíos desde el RAG del proyecto. | `rag_query` | Interno |
| `skill-web-researcher` | Sintetiza fuentes públicas para fundamentar una skill. | `web_search` | Interno |
| `skill-author` | Redacta el borrador usando el brief y la evidencia reunida. | Ninguna | Interno |
| `skill-critic` | Evalúa el borrador y produce feedback accionable. | Ninguna | Interno |

Las tools describen capacidades, pero no sustituyen los permisos. El acceso efectivo es la intersección entre las rutas del agente, las rutas del proyecto y el filtro activo de la conversación.

### Skills incluidas

| ID | Herramientas | Propósito |
|---|---|---|
| `deep-research` | `rag_query`, `web_search`, `create_note` | Investigación profunda, contrastada y con referencias. |
| `skill-creator` | Ninguna de ejecución | Guía de autoría que define el contrato y los criterios usados por el mesh creador de skills. |

Ejemplo mínimo de agente:

```markdown
---
id: reviewer
name: "Reviewer"
model: "deepseek-v4-flash"
tools: [rag_query]
permissions:
  read_paths: ["/Research/**"]
  write_paths: []
---
Revisa críticamente el material recuperado.

{{rag_context}}
{{user_prompt}}
```

El runtime usa un parser YAML compartido para agentes y skills, por lo que admite mapas y secuencias anidadas en el frontmatter. Al cargar una definición, reemplaza `{{user_prompt}}`, `{{rag_context}}` y `{{web_context}}` según las tools declaradas. Los agentes `internal: true` quedan fuera del autocompletado y los agentes visibles pueden usar cualquier icono disponible de Lucide.

## Creación asistida de agentes y skills

Sanctum puede convertir un brief en artefactos Markdown auditables sin ocultar el resultado detrás de una configuración propietaria. Ambos creadores validan el contrato antes de escribir y actualizan el autocompletado del chat al terminar.

### Agent Creator

Envía uno de estos mensajes completos en el chat:

```text
@agent-creator Revisa contratos, identifica cláusulas de riesgo y cita la fuente.
@agent-generator Crea un agente de solo lectura para comparar notas técnicas.
```

Los dos alias abren el mismo modal. Allí puedes definir:

- brief, nombre, ID e icono Lucide;
- rutas de lectura y escritura;
- exposición mediante `@mención` o uso interno del mesh;
- tools `rag_query`, `web_search`, `create_note` y `append_to_note`;
- una skill complementaria opcional.

El generador transforma el brief en un prompt operativo y presenta una revisión antes de guardar. La revisión muestra diagnósticos, ajustes automáticos, el prompt resultante y la definición Markdown completa. Los errores bloquean la confirmación; una definición válida se guarda en `sanctum-agents/{id}.md` y la skill opcional en `sanctum-skills/{skill-id}.md`.

Las reglas de seguridad se aplican también durante la autoría:

- el modelo no puede ampliar las rutas elegidas por el usuario;
- `rag_query` exige al menos una entrada en `read_paths` y las tools de escritura exigen una entrada en `write_paths`;
- un agente interno no puede exponerse mediante mención;
- los avatares deben ser iconos Lucide, no URLs ni archivos de imagen;
- un ID existente no se sobrescribe silenciosamente.

### Skill Creator

El creador de skills tiene dos modos:

```text
/skill-creator crea una skill para auditar modelos QUBO y explicar cada penalización
/skill-creator --update qubo-reviewer añade validación de unidades y casos límite
```

Para ejecutarlo necesitas un proyecto seleccionado e indexado, claves de Gemini, acceso al LLM de OpenCode y `TAVILY_API_KEY`. El pipeline aparece en el compositor del chat y conserva sus fuentes y resultado en la traza:

```text
Contexto RAG → Investigación web → Autor → Crítico
```

1. **Contexto RAG:** `skill-context-analyst` recupera únicamente notas permitidas por el proyecto y el filtro activo, identifica convenciones locales y formula vacíos sin exponer contenido privado a la web.
2. **Investigación web:** `skill-web-researcher` prioriza documentación oficial, papers, estándares y fuentes actuales mediante Tavily.
3. **Autoría:** `skill-author` combina el brief, la guía `skill-creator`, el contexto local, las fuentes públicas y el feedback acumulado.
4. **Quality gate:** `skill-critic` puntúa fundamento contextual, exactitud, actualidad, contrato Sanctum, casos límite y claridad.

El borrador debe obtener al menos `85/100`; además, contexto, exactitud de dominio, actualidad web y contrato deben alcanzar `14/20` cada uno. Si falla, el autor regenera con feedback hasta un máximo de tres intentos. Sanctum no guarda un borrador rechazado. En modo `--update`, conserva la versión previa en `sanctum-skills/.history/` antes de escribir la versión aprobada.

## Servidor MCP

El servidor MCP se ejecuta como un proceso Node independiente y se comunica mediante JSON-RPC 2.0 sobre `stdio`. `stdout` queda reservado para el protocolo; los logs estructurados se escriben exclusivamente en `stderr`.

### Tools disponibles

| Tool | Dependencia | Función |
|---|---|---|
| `sanctum_list_agents` | Ninguna | Lista agentes fijos y personalizados. |
| `sanctum_get_note` | Agente válido | Lee una nota aplicando sus `read_paths`. |
| `sanctum_query_vault` | Gemini | Ejecuta búsqueda semántica sobre el índice. |
| `sanctum_validate_qubo` | Gemini | Contrasta QUBO/Ising con el contexto autorizado y explicita inconsistencias. |
| `sanctum_invoke_agent` | OpenCode | Invoca un agente individual. |
| `sanctum_run_mesh` | OpenCode | Ejecuta Forager → Researcher → Critic. |

Configuración mínima para VS Code (`.vscode/mcp.json`):

```jsonc
{
  "servers": {
    "sanctum-ii": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-server/dist/index.cjs"],
      "env": {
        "SANCTUM_VAULT_PATH": "C:/ruta/al/vault",
        "SANCTUM_PROJECT_ID": "quantum-computing",
        "GEMINI_API_KEYS": "${env:GEMINI_API_KEYS}",
        "OPENCODE_GO_API_KEY": "${env:OPENCODE_GO_API_KEY}",
        "OPENCODE_GO_BASE_URL": "${env:OPENCODE_GO_BASE_URL}"
      }
    }
  }
}
```

`sanctum_query_vault`, `sanctum_validate_qubo` y `sanctum_invoke_agent` aceptan `project_id`. La precedencia es argumento → `SANCTUM_PROJECT_ID` → índice global legacy; antes de consultar un proyecto, MCP reconcilia su índice namespaced.

Documentación completa: [mcp-server/README.md](mcp-server/README.md). Especificación y decisiones: [Sanctum-II-MCP-Server.md](docs/Sanctum-II-MCP-Server.md).

## Seguridad y privacidad

Sanctum II aplica permisos en dos capas:

- **Proyecto:** `read_paths` y `write_paths` delimitan el contexto y los destinos válidos.
- **Agente:** cada definición declara las rutas y herramientas que puede utilizar.

Las listas de permisos vacías son **fail-closed**. El adaptador filesystem del MCP también rechaza:

- rutas absolutas y segmentos `..`;
- null bytes;
- acceso a `.env`, `.git`, `.obsidian` y `node_modules`;
- rutas que escapen del vault mediante resolución o symlinks.

Los archivos, índices y trazas se almacenan localmente. Sin embargo, al usar proveedores externos, los prompts y el contexto necesario para responder se envían a las APIs configuradas de OpenCode, Gemini o Tavily. Revisa sus políticas antes de procesar material confidencial.

## Desarrollo y calidad

| Comando | Descripción |
|---|---|
| `npm run dev` | Compila plugin y MCP en modo watch. |
| `npm run typecheck` | Ejecuta TypeScript sin emitir archivos. |
| `npm test` | Ejecuta la suite Vitest. |
| `npm run build` | Genera los bundles de producción. |
| `npm run mcp:smoke` | Comprueba protocolo, tools, permisos y errores MCP. |
| `npm run verify` | Ejecuta typecheck, tests, build y smoke test. |

La integración continua vive en `.github/workflows/ci.yml` y ejecuta `npm run verify` en pushes y pull requests.

## Estructura del repositorio

```text
Sanctum-II/
├── src/
│   ├── app/             # Servicios y orquestación del chat
│   ├── agents/          # Carga, tipos, validación y autoría de agentes
│   ├── orchestrator/    # Turnos, conversación, mesh y notas
│   ├── projects/        # Proyectos, threads, memoria e indexación
│   ├── rag/             # VectorStore persistente
│   ├── kg/              # Knowledge Graph
│   ├── chains/          # Persistencia y ejecución de cadenas
│   ├── skills/          # Skills declarativas y mesh de autoría
│   ├── shared/          # Contratos compartidos y frontmatter YAML
│   ├── core/            # Filesystem, escritura, comandos y entorno
│   └── ui/              # Vistas y componentes de Obsidian
├── mcp-server/          # Servidor MCP standalone y smoke tests
├── sanctum-agents/      # Agentes incluidos
├── sanctum-skills/      # Skills incluidas
├── docs/                # Arquitectura, especificaciones y capturas
└── .github/workflows/   # CI
```

## Estado y roadmap

Implementado:

- [x] Chat multiagente con RAG y continuidad de conversación.
- [x] Mesh Forager → Researcher ↔ Critic.
- [x] Proyectos con índices, memoria y threads aislados.
- [x] Knowledge Graph explícito y semántico.
- [x] Creación y actualización controlada de notas.
- [x] Skills, agentes personalizados y cadenas visuales.
- [x] Agent Creator con modal, revisión, permisos fail-closed e iconos Lucide.
- [x] Skill Creator contextual con RAG, investigación web, quality gate e historial.
- [x] Frontmatter YAML compartido y autocompletado dinámico de agentes y skills.
- [x] Indexación automática incremental, fingerprints SHA-256 y caché de chunks por proyecto.
- [x] Chunking consciente de LaTeX y especialización QAOA/QUBO/Ising.
- [x] Servidor MCP standalone con seis tools y selección opcional de proyecto.
- [x] Suite automatizada, smoke tests y CI.

Próximos pasos:

- [ ] Estabilizar contratos públicos y migraciones de datos.
- [ ] Ampliar cobertura de pruebas end-to-end dentro de Obsidian.
- [ ] Preparar distribución para Community Plugins.
- [ ] Documentación y experiencia completa en inglés.

## Contribuir

1. Crea un fork del repositorio.
2. Abre una rama descriptiva: `git checkout -b feature/nombre`.
3. Implementa el cambio y ejecuta `npm run verify`.
4. Crea un commit claro y abre un Pull Request.

Para cambios arquitectónicos, incluye la motivación, los límites de compatibilidad y las pruebas que protegen el nuevo comportamiento.

### Colaboradores

<a href="https://github.com/Abraham2106/Sanctum-II/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Abraham2106/Sanctum-II" alt="Colaboradores de Sanctum II">
</a>

## Soporte y feedback

- [Reporta un error](https://github.com/Abraham2106/Sanctum-II/issues/new?labels=bug&title=%5BBug%5D%3A%20) con pasos de reproducción, resultado esperado y versión de Obsidian.
- [Propón una mejora](https://github.com/Abraham2106/Sanctum-II/issues/new?labels=enhancement&title=%5BFeature%5D%3A%20) explicando el caso de uso y el beneficio esperado.
- Consulta los [issues abiertos](https://github.com/Abraham2106/Sanctum-II/issues) antes de crear uno nuevo.

Enlace del proyecto: [github.com/Abraham2106/Sanctum-II](https://github.com/Abraham2106/Sanctum-II)

## Licencia

Distribuido bajo la licencia MIT. Consulta [LICENSE](LICENSE).

## Agradecimientos

Sanctum II se construye sobre [Obsidian](https://obsidian.md), [TypeScript](https://www.typescriptlang.org), [esbuild](https://esbuild.github.io), [Google Gemini](https://ai.google.dev), [OpenCode](https://opencode.ai) y [Tavily](https://tavily.com).

<p align="right"><a href="#readme-top">Volver arriba ↑</a></p>
