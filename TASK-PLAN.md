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
