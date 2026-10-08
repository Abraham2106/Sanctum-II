task_id: T-002
from_role: planner
to_role: worker
base_ref: 904a9ef47fe8958e249f9b45b5a384da5fd6d16d
worktree: orchestration/worktrees/T-002
branch: agent/T-002
seams: [S-embed]
decisions: [DEC-0005]
resume_from: |
  Ponytail. No unifiques requestUrl y fetch. No edites indexer, query-vault ni mcp-server/index.ts. No corras tests.
done_when:
- src/embeddings/embed-contract.ts es el único sitio de modelos, 768, corte 3000 y cuerpo JSON
- GeminiBalancer y mcp embedText importan ese contrato y conservan su transporte
- El comentario ponytail nombra EmbeddingGemma 2 y el reindexado
stop_when:
- Decisión sin DEC
- Seam extra
- Dependencia nueva o descarga del modelo
- Cambio de rotación de claves o de la primera clave del MCP
verification:
  planned: ["No correr vitest, tsc ni npm."]
  run:
    - "Creado src/embeddings/embed-contract.ts (DEC-0005, ponytail, PRIORITY_MODELS, OUTPUT_DIMS 768, MAX_TEXT_LENGTH 3000, embedContentJsonBody)."
    - "gemini-balancer.ts importa contrato; sigue requestUrl y rotación de claves."
    - "mcp-server/src/embeddings/gemini-embed.ts importa contrato; sigue fetch y primera clave vía embedText."
    - "No se ejecutó vitest, tsc ni npm (según planned)."
goldens_exposed: false
alarms: []
