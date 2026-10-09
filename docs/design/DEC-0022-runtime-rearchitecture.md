# DEC-0022 — Núcleo portable y migración de Sanctum

- Status: accepted
- Decider: planner, por instrucción del usuario
- Date: 2026-10-08
- Supersedes: restricciones de alcance de SANCTUM-REFACTOR; DEC-0014 en aceptación del crítico; DEC-0020 en seguridad HTTP

## Contratos

Núcleo TypeScript sin Obsidian, DOM, filesystem ni red; puertos estructurales para proveedores, almacenamiento y trazas. Servicios de aplicación coordinan; vistas/adaptadores presentan y transportan.

Permisos: proyecto ∩ agente ∩ selección opcional. [] deniega; selección undefined no añade restricciones. No ampliar permisos al abrir proyecto. Autorizar antes de leer, embed, KG, contexto y trazas. Directorios de proyecto se normalizan a subárboles; agente conserva globs. Rutas vacías/malformadas deniegan. Resultados derivados tienen proyecto/procedencia; crítico recibe outputs sin permiso directo de lectura, siempre dentro del scope de ejecución.

Frontmatter normaliza BOM y CRLF antes de parsear, y usa extractor único con errores explícitos.

Persistencia: cola compartida por adapter/vault y recurso, locks multi-recurso ordenados. VectorStore retira solo el lote capturado tras éxito. No reclamar coordinación multiproceso: plugin escritor de índices, MCP lector; memoria y threads se escriben desde plugin.

Índices por proyecto con generaciones inmutables en sanctum-logs/index/<id>/generations/<generation>/{metadata.json,manifest.json,vector-store.jsonl,kg-edges.jsonl,commit.json}. commit.json contiene versión, generación, fecha y hashes de los cuatro archivos; se escribe temporal y se publica por rename a nombre nuevo cuando disponible. Leer solo generaciones completas válidas, más reciente por orden estable. Hash SHA-256 mediante Web Crypto portable. Métodos reader/writer y metadatos definidos en src/projects/index-generations.ts (puede separar implementación). Modelo exacto, dims y chunking integran fingerprint. No fallback de modelo en generación. Legacy conservado con rebuild_required. Cambios de vault marcan stale; indexación explícita. Una construcción fallida no reemplaza generación activa. Reusar chunks sin cambio solo si fingerprint coincide. List recursivo, sin leer fuera de permisos.

Recuperación portable: candidatos autorizados antes de top-k, umbral obligatorio, identidad/dimensiones compatibles. Selección no reemplaza proyecto. No logs/trazas de paths no autorizados.

MCP notes/query aceptan project_id -> SANCTUM_PROJECT_ID -> PROJECT_REQUIRED. Catálogo no requiere proyecto. No fallback global. Carga/refresco de generación por llamada. Invoke/mesh siguen contexto suministrado, sin recuperación oculta. Bind loopback estricto (127.0.0.1, ::1, localhost), token HTTP obligatorio, Origin exact allowlist configurable (SANCTUM_MCP_ORIGINS separada por comas); ausente permite cliente nativo autenticado; null/otro devuelve 403. Límite 1 MiB. Node launcher portable.

DAG: validate IDs/edges/duplicates/cycles antes de proveedor; orden estable; secuencial; nodo recibe solo original+predecesores directos. Resultados estructurados terminalOutputs, provenance, projectId y status completed/failed/cancelled; compat finalOutput único o secciones deterministas. Error conserva parciales. Canvas/chat un ejecutor.

Mesh: núcleo común en src/runtime/mesh.ts. 3 intentos, accept 80, escalate 40. accepted solo score>=threshold AND verdict accept. Stagnation/exhaustion -> needs_review; selectedAttempt pareja output+score del mejor. Estados accepted/needs_review/escalated/failed/cancelled/timed_out. Timer limpio; abort real fetch; requestUrl cancelación lógica. No orquestador salta gate.

Modelo: agente explícito > proyecto explícito > global/env; cargador conserva ausencia como string vacío por compatibilidad del tipo existente. Proveedor configuración explícita, no inferido por modelo. Chat admite opciones por llamada sin romper overloads actuales.

## Verificación y entrega

Composer 2.5 CLI headless por hoja/worktree; máximo tres workers, reviewer independiente y judge coordinador. Dos loops review. Tests dirigidos por hoja, suite por hito. Dobles explícitos solo tests de contratos, no evidencia live. Sin llamadas externas con notas/credenciales. Índices/originales y generaciones previas conservados. Validación Obsidian pendiente si runtime no disponible; nunca afirmar producción sin ella.

Rama codex/sanctum-runtime-rearchitecture. JSON task-tree canónico; TASK-PLAN sincronizado; sin goldens expuestos. Nuevas APIs públicas llevan documentación. Rollback revert commits en orden inverso; datos versionados y backups, no borrar legacy.
