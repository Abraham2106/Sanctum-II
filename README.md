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
    <a href="docs/registro-arquitectura.md"><strong>Arquitectura</strong></a>
    ·
    <a href="mcp-server/README.md"><strong>Servidor MCP</strong></a>
    ·
    <a href="https://github.com/Abraham2106/Sanctum-II/issues"><strong>Issues</strong></a>
  </p>
</div>

> [!IMPORTANT]
> Sanctum II está en desarrollo activo (`v0.1.0`) y funciona únicamente en Obsidian Desktop. Antes de usarlo con información sensible, revisa la sección de [seguridad y privacidad](#seguridad-y-privacidad).

<details>
  <summary><strong>Tabla de contenidos</strong></summary>

- [Visión general](#visión-general)
- [Capacidades principales](#capacidades-principales)
- [Experiencia del producto](#experiencia-del-producto)
- [Cómo funciona](#cómo-funciona)
- [Inicio rápido](#inicio-rápido)
- [Primer uso](#primer-uso)
- [Flujos de trabajo](#flujos-de-trabajo)
- [Proyectos y almacenamiento](#proyectos-y-almacenamiento)
- [Recuperación y Knowledge Graph](#recuperación-y-knowledge-graph)
- [Agentes y skills](#agentes-y-skills)
- [Servidor MCP](#servidor-mcp)
- [Seguridad y privacidad](#seguridad-y-privacidad)
- [Desarrollo y calidad](#desarrollo-y-calidad)
- [Estado y roadmap](#estado-y-roadmap)

</details>

## Visión general

Sanctum II integra chat, recuperación semántica, agentes especializados, proyectos aislados y escritura controlada de notas dentro de Obsidian. El contenido y el estado operativo permanecen en el vault: proyectos, threads, memoria, índices, trazas, agentes, skills y cadenas se almacenan como Markdown o JSONL inspeccionable.

La plataforma ofrece dos superficies sobre el mismo conocimiento:

- **Plugin de Obsidian:** experiencia visual para conversar, investigar, administrar proyectos, explorar el Knowledge Graph y diseñar cadenas de agentes.
- **Servidor MCP standalone:** proceso Node sobre `stdio` que permite consultar el vault e invocar agentes desde VS Code, OpenCode y otros clientes compatibles, incluso sin Obsidian abierto.

### Por qué existe Sanctum II

Un chat genérico puede responder preguntas, pero normalmente desconoce cómo está organizado un vault, qué carpetas puede leer, dónde debe escribir y qué conversación pertenece a cada proyecto. Sanctum II añade esa capa operativa:

- **El contexto tiene límites:** cada proyecto y agente declara las rutas que puede consultar o modificar.
- **La investigación deja un artefacto:** una respuesta puede transformarse en una nota Markdown autónoma, con fórmulas, citas y referencias conservadas.
- **Los flujos son inspeccionables:** prompts, agentes, skills, proyectos, índices y trazas se guardan en formatos abiertos.
- **La interfaz no encierra el conocimiento:** el mismo vault puede utilizarse desde Obsidian o desde clientes externos mediante MCP.
- **La crítica forma parte del proceso:** el mesh no se limita a encadenar respuestas; evalúa el resultado y puede pedir una regeneración antes de entregarlo.

## Capacidades principales

| Área | Capacidad |
|---|---|
| **Chat contextual** | Conversaciones persistentes, resumen progresivo, menciones `@agente` y continuidad al crear notas desde una investigación previa. |
| **RAG por proyecto** | Índices vectoriales independientes, filtros por `read_paths`, manifiesto incremental y reindexado total o parcial. |
| **Mesh de investigación** | Pipeline Forager → Researcher ↔ Critic con evaluación, feedback, regeneración y escalado. |
| **Proyectos** | Threads, memoria, archivos adjuntos, instrucciones, rutas de lectura/escritura y carpeta de salida propias. |
| **Knowledge Graph** | Relaciones por wikilinks, similitud semántica y refuerzo de conexiones. |
| **Notas accionables** | Creación y actualización de Markdown con permisos fail-closed y registro de la ruta realmente escrita. |
| **Agentes y skills** | Definiciones declarativas en Markdown con frontmatter, herramientas y permisos explícitos. |
| **Cadenas visuales** | Composición y ejecución de flujos dirigidos de agentes desde Obsidian. |
| **MCP** | Cinco tools para listar agentes, leer notas, consultar RAG, invocar agentes y ejecutar el mesh. |
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
GEMINI_API_KEYS=AIza-key-1,AIza-key-2
TAVILY_API_KEY=tvly-tu-api-key
```

`TAVILY_API_KEY` es opcional. Sin ella, las funciones de búsqueda web se omiten y el resto del flujo continúa disponible.

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
- serializa solicitudes concurrentes por proyecto;
- conserva otras carpetas durante un reindexado parcial;
- elimina del índice archivos borrados durante un reindexado completo;
- inicia vacío, sin tratar la ausencia del primer índice como error.

## Recuperación y Knowledge Graph

### RAG vectorial

El indexador recorre únicamente las carpetas autorizadas del proyecto, divide las notas en chunks, genera embeddings con Gemini y persiste transacciones compactas en JSONL. La configuración predeterminada utiliza embeddings de `768` dimensiones, chunks de hasta `400` palabras, `top_k = 5` y similitud mínima de `0.65`; cada proyecto puede ajustar estos valores.

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

Las tools describen capacidades, pero no sustituyen los permisos. El acceso efectivo es la intersección entre las rutas del agente, las rutas del proyecto y el filtro activo de la conversación.

### Skill incluida

| ID | Herramientas | Propósito |
|---|---|---|
| `deep-research` | `rag_query`, `web_search`, `create_note` | Investigación profunda, contrastada y con referencias. |

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

## Servidor MCP

El servidor MCP se ejecuta como un proceso Node independiente y se comunica mediante JSON-RPC 2.0 sobre `stdio`. `stdout` queda reservado para el protocolo; los logs estructurados se escriben exclusivamente en `stderr`.

### Tools disponibles

| Tool | Dependencia | Función |
|---|---|---|
| `sanctum_list_agents` | Ninguna | Lista agentes fijos y personalizados. |
| `sanctum_get_note` | Agente válido | Lee una nota aplicando sus `read_paths`. |
| `sanctum_query_vault` | Gemini | Ejecuta búsqueda semántica sobre el índice. |
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
        "GEMINI_API_KEYS": "${env:GEMINI_API_KEYS}",
        "OPENCODE_GO_API_KEY": "${env:OPENCODE_GO_API_KEY}",
        "OPENCODE_GO_BASE_URL": "${env:OPENCODE_GO_BASE_URL}"
      }
    }
  }
}
```

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
│   ├── agents/          # Carga y tipos de agentes
│   ├── orchestrator/    # Turnos, conversación, mesh y notas
│   ├── projects/        # Proyectos, threads, memoria e indexación
│   ├── rag/             # VectorStore persistente
│   ├── kg/              # Knowledge Graph
│   ├── chains/          # Persistencia y ejecución de cadenas
│   ├── skills/          # Skills declarativas
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
- [x] Servidor MCP standalone con cinco tools.
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

## Licencia

Distribuido bajo la licencia MIT. Consulta [LICENSE](LICENSE).

## Créditos

Sanctum II se construye sobre [Obsidian](https://obsidian.md), [TypeScript](https://www.typescriptlang.org), [esbuild](https://esbuild.github.io), [Google Gemini](https://ai.google.dev), [OpenCode](https://opencode.ai) y [Tavily](https://tavily.com).

<p align="right"><a href="#readme-top">Volver arriba ↑</a></p>
