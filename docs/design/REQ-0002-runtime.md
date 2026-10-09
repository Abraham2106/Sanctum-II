# REQ-0002 — Re-arquitectura aprobada

El usuario autorizó implementar el plan completo mediante Composer 2.5 headless. DEC-0022 fija contratos y reemplaza las exclusiones históricas de recursión, separación interna de UI y verificación por hoja. Sin cambios de apariencia, SQLite, OAuth remoto, embedding local o features Discord nuevas. Los índices antiguos se conservan hasta reindexado explícito. Source of truth: task-tree.json. Pruebas y review antes de integración. Aprobación final: automatizada + validación Obsidian cuando esté disponible.

Extensión autorizada 2026-10-08: infraestructura opcional local de texto EmbeddingGemma 2 según DEC-0023; sustituye exclusión anterior de embeddings locales. Las pruebas de contrato no equivalen a benchmark/inferencia real.
