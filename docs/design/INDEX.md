# Design index

Cada decisión tiene un id estable `DEC-XXXX`. El planner la escribe. El worker la cita. El judge fusiona conflictos de docs, no de código.

| ID | Título | Status | Seams |
|---|---|---|---|
| DEC-0001 | Planner no implementa; worker no diseña | accepted | S-orch |
| DEC-0002 | Orquestación reanudable | accepted | S-orch |
| DEC-0003 | Refactor por dueño | accepted | S-defaults |
| DEC-0004 | Router de chat | accepted | S-llm |
| DEC-0005 | Contrato de embedding | accepted | S-embed |
| DEC-0006 | Chunk y filtro de cadena | accepted | S-index, S-chain |
| DEC-0007 | Poda de código sin llamadores | accepted | S-prune-const, S-prune-ui, S-prune-symbols, S-prune-scan |

Plantilla: `_template.md`. Requisitos: `REQ-0001-product.md`.
