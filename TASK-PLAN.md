# TASK-PLAN

feature_id: SANCTUM-REFACTOR
status: ready
scope: Refactor por dueño. Router de chat de dos cables. Contrato de embedding. Dos bugs nombrados. Suite al final.

## Gobierno

JSON canónico: `orchestration/task-tree.json`. Una hoja, un seam y un worktree por worker Composer 2.5. Planner y reviewer no implementan dominio. Máximo dos reviews. No afirmar integración con mocks o skips.

Rollback: revertir solo commits de la hoja; conservar worktrees, evidencia y cambios previos.

## Registro

- T-000: Ingerir requisitos — done (planner).
- T-001: Router de chat OpenAI-compatible y Anthropic — ready (S-llm, DEC-0004).
- T-002: Contrato de embedding Gemini, hueco para EmbeddingGemma 2 — ready (S-embed, DEC-0005).
- T-003: Un solo dueño de los literales RAG y de trazas — ready (S-defaults, DEC-0003).
- T-004: El indexador usa `chunk_words` — ready (S-index, DEC-0006).
- T-005: La cadena reenvía `pathFilter` — ready (S-chain, DEC-0006).
- T-001..T-005: hechas y mergeadas.
- T-007: Borrar exports muertos de `constants.ts` — ready (S-prune-const, DEC-0007).
- T-008: Borrar `chain-inspector.ts` — ready (S-prune-ui, DEC-0007).
- T-009: Borrar cuatro símbolos sin uso — ready (S-prune-symbols, DEC-0007).
- T-010: Barrido de orquestador y core — ready (S-prune-scan, DEC-0007).
- T-006: typecheck y vitest en verde sobre la poda ya mergeada.
- T-011..T-015: reescritura por trabajo de los cinco archivos de más de 400 líneas (DEC-0008).
- T-016: los cuatro símbolos de DEC-0007 que no llegaron a borrarse.

Paralelo ahora: T-011, T-012, T-013, T-014, T-015, T-016. No comparten archivos. La suite corre después del merge.

## Self-improve 2026-10-08

- T-017: anclar `globMatch` (S-glob, DEC-0009) — ready.
- T-018: score ausente del crítico = 0 (S-critic-parse, DEC-0010) — ready.
- T-019: el MCP recorre las claves Gemini (S-mcp-keys, DEC-0011) — ready.

Las tres no comparten archivos. La suite completa corre en la rama después del merge.

## Discord (DEC-0019)

- T-026: nota de canal (S-discord-log) — done.
- T-027: destino Grok y REST de Discord (S-discord-api) — done.
- T-028: agente y variables (S-discord-agent) — done.
- T-029: proceso del bot (S-discord-bot) — done.

## Grok Bot (DEC-0020)

- T-030: MCP por HTTP para el conector de Grok Bot (S-mcp-http) — done.

## MCP (DEC-0021)

- T-031: instructions y annotations (S-mcp-guide) — done.
- T-032: listar notas (S-mcp-notes) — done.
- T-033: context en invocar y mesh (S-mcp-context) — done.
- T-034: corte de 1 MiB (S-mcp-limit) — done.

Las cuatro no comparten archivos. T-034 solo añade el tope en el HTTP que T-030 ya mergeó.

## SANCTUM-RUNTIME-V2

status: ready
feature_id: SANCTUM-RUNTIME-V2

DEC-0022 gobierna el nuevo alcance. JSON canónico. Coordinator escribe gobierno; Composer 2.5 CLI headless implementa solo worktree por hoja; reviewer independiente; judge integra. Máximo tres workers y dos loops de review. Dependencias integradas antes de spawn. Tests dirigidos antes de review y suite por hito. No goldens. Dobles explícitos solo tests, no prueba live. Rollback inverso por commits, índices antiguos conservados. Sin deploy/publicación.

- T-035: Frontmatter portable CRLF/BOM — ready; deps none
- T-036: Política permisos y recuperación portable — ready; deps T-035
- T-037: HTTP autenticado loopback — ready; deps none
- T-038: Durabilidad por recurso — ready; deps none
- T-039: DAG y mesh común — ready; deps T-036
- T-040: Generaciones e indexador — ready; deps T-036, T-038
- T-041: MCP servicios por proyecto — ready; deps T-039, T-040, T-037
- T-042: Composición plugin y servicios — ready; deps T-039, T-040, T-045
- T-043: Vistas con servicios comunes — ready; deps T-042
- T-044: CI smoke auditoría y documentación — ready; deps T-041, T-043
- T-045: Resolución proveedores portable — ready; deps T-035

Cada hoja: planner→worker→reviewer/verificador→judge. Entry ready+deps done+worktree; output commit owned+tests+handoff; stop nueva DEC/seam/hecho; DONE exige review sin P1/P2, commands_run reales, evidencia y docs sincronizadas. Live Obsidian unavailable bloquea declaración de producción, no entrega automatizada.

- T-046: Skills/notas permisos y proveedores — ready; deps T036,T040,T045. T042 waits for T046. T036 includes portable turn/ports; T043 includes all mesh state labels.

T-039 incluye los parsers de evaluación compartidos y de cadenas: aceptación exige score válido y veredicto explícito. T-045 depende también de T-036 para reutilizar sus puertos sin duplicarlos. Tras integrar cada hoja se conserva su commit/evidencia y se retira y poda su worktree (instrucción del usuario).

T-035 integrada en 44e7606: revisión independiente Sol 6.1, 11 regresiones y typecheck correctos. Validación Obsidian pendiente del hito final.

Primer control de integración (44e7606): suite completa 28 archivos / 228 pruebas correctas (217 existentes + 11 nuevas). node_modules restaurado con npm ci --ignore-scripts. En Windows, desvincular junction de dependencias antes de git worktree remove; preferir instalaciones independientes.

T-041 incluye invoke-agent para resolver su modelo explícito y validar IDs sin recuperación oculta. T-039 consume APIs de proveedor de T-045 y por eso depende de ella. Resolver MCP conserva errores YAML con archivo.

T-037 integrada en 8ddceb2 + c6d1fce, revisión Sol 6.1 y 24 pruebas HTTP correctas. Token/Origin se conectan al arranque en T-041. Worktree propio sin junction, retirado tras conservar evidencia.

T-040 incluye embed-contract (dimensiones explícitas) y la propagación de errores list del adaptador filesystem: un fallo de recorrido no equivale a una carpeta vacía ni autoriza publicar eliminaciones. Conserva todas las protecciones de rutas.

T-045 recibe después de T-036 la propiedad de runtime/turn.ts solo para conectar opciones por llamada; no hay escritores simultáneos. Investigación de EmbeddingGemma 2 y encaje local autorizada por usuario, sin activar embeddings locales ni ampliar esta implementación.

T-038 borrador 13aa528 en REVIEW, no aceptada: 52 pruebas/typecheck pasan pero persiste pérdida de baseline en load y contratos read-only alterados. Tras dos reviews se divide T-047 (load/replay Vector/KG y regresiones correctas), base 13aa528; T-040 espera T-038 y T-047 aceptadas. Propiedad serial, sin writers simultáneos.

T-036 núcleo en REVIEW tras 30 tests/typecheck; T-048 acota el bloqueo restante de identidad projectId en recuperación pública. No aceptación hasta regresiones directas correctas. T-040/T-045 esperan T-048.

DEC-0023 amplía alcance por usuario: T-050 sidecar Python seguro solo texto (independiente), T-049 puerto/cliente/config compartido tras T-036/T-038/T-047/T-048. T-040/T-041/T-042/T-043/T-044 consumen contrato nuevo. T-045 recibe turn después de T-049 sin writer compartido. Gemini default, local explícito, sin descargas/fallback remoto. Validación de modelo real/recursos/calidad pendiente de cache y runtime; tests de contrato separados.

T-048 e2ba2dc aceptada; núcleo T-036 queda aceptado tras 35 pruebas de runtime y typecheck sobre rama integrada. Worktree T-048 retirado/podado con dependencias propias. Descriptor JSON exacto de DEC-0023 congelado para paridad Python/TS.

T-047 propiedad de split explícita en helpers vector-store-*.ts/kg-store-*.ts; revisión detecta intents mutables, retiro incompleto y orden incorrecto de tombstones, última corrección de la hoja en curso. T-050 revisión requiere descriptor congelado, offline/revisión/prefijos reales y schemas adversos; contrato no aceptado todavía.

T-047 borrador de código integrado excluyendo HANDOFF, sigue REVIEW: 75 tests/typecheck pasan pero faltan snapshot capturado, KG append-only y split. T-051 acota estos tres casos de lifecycle/split, prerequisito de aceptación T-038/T-047 y de T-040/T-049. T-045 se adelanta (deps T-036/T-048); T-049 recibe turn después, sin writes simultáneos.

T-051 `cb95d0c`, T-045 `1480c7b` y T-050 `f539d21`+`0ea1761` aceptadas en la rama. 92 pruebas de las hojas y 23 unittest del sidecar pasan sobre el HEAD integrado. T-038 y T-047 quedan cerradas por T-051. Siguiente paralelo: T-039 (DAG/mesh) y T-049 (cliente local). T-049 solo añade propósito e identidad de embedding en `turn.ts`; no reescribe la resolución de chat de T-045. Composer nativo, sin CLI headless.

T-039 `8d9a6f2` aceptada: 36 pruebas de DAG, mesh, crítico y parse. La aceptación exige score válido y veredicto explícito. El abort del mesh del plugin, dentro de `executeTurn`, queda en T-052 y espera a que T-049 suelte `turn.ts`.

T-049 aceptada en `9b9069c` y partida en `2294834`. Los archivos de identidad quedan bajo 400 líneas. T-052 puede cablear `AbortSignal` en `TurnDeps` y pasarlo desde el mesh y el ejecutor de cadenas.

T-052 `66a3724` aceptada: 25 pruebas. El mesh y las cadenas pasan la señal al turno, y un turno ya abortado no llama al proveedor. Siguiente hoja: T-040, generaciones de índice.

T-040 `90bec41` aceptada: 22 pruebas. Generaciones inmutables, permisos vacíos deniegan la indexación y un fallo no sustituye la generación anterior. Siguiente paralelo: T-041 (MCP por proyecto) y T-046 (skills y notas).

T-041 `e69ac1f` aceptada: 17 pruebas. Las herramientas de notas y consulta exigen proyecto y leen la generación publicada. T-042 espera a que T-046 termine.

T-046 `5dea018` aceptada: 22 pruebas. Skills y notas usan el ámbito efectivo, y las escrituras de notas pasan por la cola. Siguiente: T-042, composición del plugin.

T-042 `344c3b0` aceptada. `main.ts` queda en 338 líneas. Abrir un proyecto no rellena permisos, un evento del vault no genera embeddings, y `needs_review` no escribe notas. Siguiente: T-043, vistas.

T-043 aceptada en `cb07fea` y `f1714a2`. Las vistas quedan bajo 400 líneas y el canvas recibe cancelación e índice. Siguiente y última hoja de implementación: T-044, CI, smoke y documentación.

T-044 `48d0787` aceptada, con el doble de `note-flow` en `4fb2d5e`. Vitest: 66 archivos, 450 pruebas. CI cubre Windows y Linux. La validación manual dentro de Obsidian sigue pendiente; eso no es un cierre de producción.

T-011 a T-016 quedan bloqueadas: DEC-0022 ya extrajo los servicios y partió las vistas. No se reabren.
