task_id: T-001
from_role: planner
to_role: worker
base_ref: 904a9ef47fe8958e249f9b45b5a384da5fd6d16d
worktree: orchestration/worktrees/T-001
branch: agent/T-001
seams: [S-llm]
decisions: [DEC-0004]
resume_from: |
  Ponytail. El diff más corto. No corras vitest ni npm. Cita DEC-0004 y el comentario ponytail del techo de Cursor en chat-wire.ts. Transporte del plugin: requestUrl. Transporte MCP: fetch. No añadas /v1 a la base OpenAI. max_tokens Anthropic = 4096. Modelo vacío usa DEFAULT_MODEL; no cambies deepseek-v4-flash por un Claude en silencio. configured es true solo si el cable activo tiene clave.
done_when:
- src/llm/chat-wire.ts arma y parsea openai y anthropic sin red y sin dependencias
- OpenCodeClient conserva el nombre, chat() y constructor (baseUrl, apiKey, opts?)
- Ajustes y .env.example exponen llmProvider, llmModel, anthropicApiKey, anthropicBaseUrl sin renombrar opencodeApiKey ni opencodeBaseUrl
- opencodeChat mantiene la firma y lee LLM_PROVIDER, LLM_MODEL, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL
- src/llm/chat-wire.test.ts cubre build y parse de los dos cables
stop_when:
- Decisión sin DEC
- Seam extra
- Hace falta @cursor/sdk o una dependencia
- Hay que editar chat-orchestrator, agent-turn, services o las tools MCP
verification:
  planned: ["No correr vitest, tsc ni npm. Dejar src/llm/chat-wire.test.ts en el árbol."]
  run:
    - "Seam-only diff: chat-wire.ts (+ DEC-0004/ponytail header), chat-wire.test.ts, opencode-client.ts, constants.ts, env-loader.ts, main.ts (client opts), settings-tab.ts, .env.example, mcp-server/src/llm/opencode-chat.ts"
    - "vitest/tsc/npm no ejecutados (per HANDOFF planned)"
goldens_exposed: false
alarms: []
