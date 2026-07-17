# Objetivos y casos de uso de Sanctum II

Este documento es el contrato canónico de producto para orientar arquitectura, implementación y pruebas. La motivación inicial fue preparar una hackathon de computación cuántica a partir de notas propias y papers convertidos a Markdown; ese dominio es el primer caso de referencia, no un límite del producto.

## Objetivo general

El objetivo general de Sanctum II es proporcionar una base de conocimiento local, trazable y extensible sobre la que agentes de IA puedan apoyarse durante proyectos de programación. El sistema debe procesar notas propias y papers convertidos a Markdown, recuperar conocimiento relevante sin perder fórmulas ni contexto técnico, generar nuevas notas y permitir crear agentes y skills especializados. Estas capacidades deben estar disponibles tanto desde el chat de Obsidian como mediante MCP en el entorno de desarrollo.

“Local-first” significa que el corpus, los proyectos, los índices, los manifiestos y las trazas pertenecen al vault y permanecen inspeccionables. No significa operación completamente offline: Gemini, OpenCode y Tavily son proveedores externos configurables.

## Objetivos medibles

### OBJ-01 — Ingesta incremental

Incorporar Markdown nuevo o modificado sin reindexar contenido intacto. Un documento y una configuración sin cambios deben producir cero llamadas de embeddings; una modificación debe recalcular solamente los chunks afectados.

### OBJ-02 — Recuperación confiable

Entregar contexto relevante respetando el índice del proyecto, el agente activo y sus `read_paths`. Ninguna consulta, reconciliación o tool debe convertir un permiso vacío o inválido en acceso implícito.

### OBJ-03 — Fidelidad técnica

Preservar LaTeX inline y en bloque, entornos de ecuaciones, código, referencias, convenciones y vínculo con la nota de origen durante chunking, embedding, recuperación y escritura Markdown.

### OBJ-04 — Evolución del conocimiento

Convertir resultados útiles en notas nuevas o actualizadas y reincorporarlas automáticamente al índice de cada proyecto autorizado, cerrando el ciclo investigación → artefacto → recuperación.

### OBJ-05 — Especialización

Crear agentes y skills declarativos apoyados en las convenciones reales del corpus. La especialización cuántica inicial incluye QAOA, Ising y QUBO, el agente `qc-programmer` y su auto-chequeo explícito.

### OBJ-06 — Doble superficie

Ofrecer el mismo conocimiento desde el chat de Obsidian y desde clientes de desarrollo mediante el servidor MCP standalone sobre `stdio`, manteniendo índices y contratos compatibles.

### OBJ-07 — Calidad y control

Mantener permisos fail-closed, logging MCP exclusivamente por `stderr`, trazas y verificaciones automatizadas de tipos, tests, build y protocolo JSON-RPC 2.0.

### OBJ-08 — Adaptabilidad

Cambiar de dominio mediante proyectos, corpus, agentes y skills declarativos, sin modificar el núcleo. Cada proyecto conserva su propio índice y caché; no se comparten embeddings entre proyectos.

## Matriz de trazabilidad

| Objetivo | Componentes principales | Criterio de aceptación | Pruebas o verificación | Estado |
|---|---|---|---|---|
| OBJ-01 | `IncrementalIndexCoordinator`, `IndexManifestV2`, `VectorStore` | Cero embeddings sin cambios; reutilización por chunk; create/modify/delete/rename automáticos | `indexer.test.ts`, `index-coordinator.test.ts` | Implementado |
| OBJ-02 | `ProjectStore`, `PermissionResolver`, RAG por proyecto | La consulta combina proyecto y `read_paths`; vacío significa denegado | tests de permisos, query y QUBO | Implementado |
| OBJ-03 | formula-aware chunker, note writer, fuentes por `note_path` | Ninguna fórmula o bloque de código se corta; Markdown se escribe sin escapes destructivos | tests de chunker y note writer | Implementado |
| OBJ-04 | note writer, eventos del vault, coordinador incremental | Una nota creada o modificada se vuelve recuperable sin indexación manual | tests del coordinador e integración del plugin | Implementado |
| OBJ-05 | loader YAML, Agent/Skill Creator, `qc-programmer`, `sanctum_validate_qubo` | Definiciones antiguas siguen cargando; el auto-chequeo no oculta inconsistencias | tests de agentes, skills y QUBO | Implementado |
| OBJ-06 | plugin Obsidian, MCP server, `VaultAdapter` | Consulta equivalente desde ambas superficies; fallback legacy compatible | typecheck, build y smoke MCP | Implementado |
| OBJ-07 | permisos, logger MCP, TraceWriter, Vitest | `npm run verify` sin regresiones y stdout reservado al protocolo | suite Vitest y smoke JSON-RPC | Verificación continua |
| OBJ-08 | proyectos declarativos e índices namespaced | Cambiar corpus/agentes/skills sin cambiar core; caché aislada por proyecto | tests multi-proyecto | Implementado |

## Contrato de indexación adaptativa

El ciclo de datos es:

```text
documento Markdown
  → SHA-256 del contenido
  → chunker versionado consciente de fórmulas
  → SHA-256 de cada chunk + configuración
  → embedding nuevo o caché del proyecto
  → VectorStore namespaced
  → recuperación RAG con read_paths
```

Cada manifiesto `IndexManifestV2` registra `schema_version`, ruta, fingerprint del documento, fingerprint de configuración, hashes de chunks y fecha de indexación. La configuración incluye modelo, dimensiones, límite de palabras y versión del chunker. Un manifiesto antiguo provoca una única reconstrucción segura.

En Obsidian, los eventos `create`, `modify`, `delete` y `rename` de Markdown se agrupan durante 1,5 segundos, se coalescen y se serializan por proyecto. La apertura del plugin reconcilia cambios ocurridos mientras estuvo cerrado. Las rutas internas y los archivos fuera de `read_paths` se excluyen antes de leer.

En MCP, `sanctum_query_vault`, `sanctum_validate_qubo` y `sanctum_invoke_agent` aceptan `project_id`. La precedencia es argumento → `SANCTUM_PROJECT_ID` → índice global legacy. Un proyecto usa `sanctum-logs/index/{projectId}/` y se reconcilia antes de una consulta RAG. Si faltan credenciales de Gemini, el contenido permanece intacto y se reintenta al abrir, recibir otro evento o consultar más adelante.

## Casos de uso

### CU-01 — Preparar conocimiento para una hackathon cuántica

- **Actor:** participante o equipo de programación cuántica.
- **Precondiciones:** proyecto creado; notas y papers Markdown dentro de `read_paths`; Gemini configurado.
- **Flujo:** agregar el corpus, dejar que el coordinador lo indexe, consultar conceptos QAOA/Ising/QUBO y guardar hallazgos.
- **Resultado:** corpus recuperable y trazable por fuente, con fórmulas intactas.
- **Éxito:** un documento nuevo aparece en resultados sin ejecutar una indexación manual.

### CU-02 — Consultar notas y papers desde Obsidian

- **Actor:** usuario del plugin.
- **Precondiciones:** proyecto y agente seleccionados.
- **Flujo:** formular una pregunta en el chat; resolver permisos; recuperar chunks; generar una respuesta con fuentes.
- **Resultado:** respuesta contextual dentro del thread del proyecto.
- **Éxito:** solo aparecen notas permitidas y cada evidencia conserva `note_path`.

### CU-03 — Consultar el proyecto desde VS Code u OpenCode mediante MCP

- **Actor:** desarrollador en un cliente MCP.
- **Precondiciones:** servidor compilado, vault y variables de entorno configurados.
- **Flujo:** invocar una tool con `project_id`, o usar `SANCTUM_PROJECT_ID`; reconciliar; consultar el índice.
- **Resultado:** el mismo corpus está disponible sin abrir Obsidian.
- **Éxito:** JSON-RPC permanece válido, los logs van a `stderr` y el fallback legacy sigue funcionando.

### CU-04 — Formular y validar QUBO/Ising/QAOA con `qc-programmer`

- **Actor:** programador cuántico.
- **Precondiciones:** corpus técnico indexado y agente `qc-programmer` disponible.
- **Flujo:** proponer matriz o expresión; recuperar contexto autorizado; comprobar convención 0/1 vs ±1, signos, simetría y normalización.
- **Resultado:** formulación acompañada por inconsistencias o advertencias explícitas.
- **Éxito:** el auto-chequeo nunca silencia un conflicto detectado ni lee fuera de `read_paths`.

### CU-05 — Contrastar notas propias con papers adicionales

- **Actor:** investigador o desarrollador.
- **Precondiciones:** notas propias y papers dentro del mismo proyecto.
- **Flujo:** añadir papers, indexar solo material nuevo, recuperar ambas clases de fuente y solicitar contraste al mesh.
- **Resultado:** síntesis que distingue evidencia propia y externa.
- **Éxito:** documentos intactos no generan embeddings nuevos y las fuentes quedan identificadas.

### CU-06 — Convertir una investigación en una nota preservando LaTeX

- **Actor:** usuario de Obsidian.
- **Precondiciones:** `write_paths` autoriza el destino.
- **Flujo:** generar investigación; crear o anexar Markdown; disparar autoindexación.
- **Resultado:** nota reutilizable con LaTeX, código y referencias sin escapes destructivos.
- **Éxito:** el contenido escrito coincide con la sintaxis producida y luego es recuperable por RAG.

### CU-07 — Crear o actualizar agentes especializados desde el corpus

- **Actor:** diseñador de agentes.
- **Precondiciones:** corpus indexado y permisos para `sanctum-agents/` según el flujo de autoría.
- **Flujo:** extraer convenciones, generar frontmatter y prompt, validar contrato y guardar.
- **Resultado:** agente declarativo compatible con el loader actual.
- **Éxito:** definiciones existentes continúan cargando y cualquier `auto_check` es opcional.

### CU-08 — Crear o actualizar skills de programación con quality gate

- **Actor:** diseñador de skills.
- **Precondiciones:** contexto RAG y, si se desea contraste público, Tavily configurado.
- **Flujo:** analizar corpus, contrastar web, redactar, criticar y regenerar hasta alcanzar el umbral.
- **Resultado:** skill Markdown versionable con historial de actualización.
- **Éxito:** pasa validación estructural y explicita fuentes, límites y tools requeridas.

### CU-09 — Incorporar documentos nuevos y reutilizar embeddings

- **Actor:** usuario, Obsidian o cliente MCP.
- **Precondiciones:** proyecto existente y documento permitido.
- **Flujo:** detectar cambio, calcular fingerprints, reutilizar chunks idénticos y generar solo embeddings faltantes.
- **Resultado:** índice actualizado sin duplicación de trabajo dentro del proyecto.
- **Éxito:** no hay chunks obsoletos tras delete/rename y no existe deduplicación entre proyectos.

## No-objetivos iniciales

- Entrenar o ajustar modelos fundacionales.
- Administrar ejecución en hardware cuántico o proveedores de quantum cloud.
- Demostrar ventaja cuántica.
- Garantizar operación completamente offline.
- Compartir automáticamente embeddings o conocimiento entre proyectos aislados.

Gemini, OpenCode y Tavily continúan siendo proveedores externos configurables. Sustituirlos debe ser posible mediante adaptadores, pero construir proveedores equivalentes forma parte de trabajos posteriores.
