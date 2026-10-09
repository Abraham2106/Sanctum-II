# EmbeddingGemma 2 y Sanctum — investigación, 2026-10-08

Estado: investigación de dos subagentes Sol 6.1, solicitada por el usuario. No activa un proveedor local ni sustituye DEC-0022. No se descargaron modelos, midieron recursos ni hicieron llamadas con credenciales.

## Hallazgos verificados

Google lanzó EmbeddingGemma 2 el 6 de octubre de 2026. `google/embeddinggemma-2` es un modelo local de pesos abiertos con licencia Apache 2.0. Tiene aproximadamente 740 M de parámetros completo y 270 M con solo texto/código. No es `gemini-embedding-2`, el proveedor de API usado por Sanctum. [Anuncio Google](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/).

La carga selectiva oficial usa `config_kwargs={"vision_config": None, "audio_config": None}`. Enviar solo texto sin esa configuración no demuestra que se hayan descargado los otros encoders. Texto solo elimina aproximadamente el 64 % de parámetros frente al modelo completo. [Guía oficial](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers).

El modelo tiene contexto de 8192 tokens, salida de 768 dimensiones y reducción MRL a 512/256/128 con renormalización. Requiere BF16 o FP32: FP16 puede generar NaN o degradación. Los prefijos para consultas y documentos forman parte del contrato de uso. [Model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

270 M de pesos representan aproximadamente 540 MB en BF16 o 1,08 GB en FP32 por aritmética, sin activaciones, buffers, tokenizer, runtime ni picos de carga. **1–2 GB de VRAM no es un requisito universal verificado.** Google publica unos 191 MB de RAM activa para pesos de texto cuantizados en Pixel 11 Pro, una medición de otro backend/hardware. CPU puede evitar VRAM dedicada a cambio de RAM y tiempo.

## Cómo funciona Sanctum en el snapshot investigado

El contrato existente solicita Gemini a 768 dimensiones, con fallback entre `gemini-embedding-2` y `gemini-embedding-001`. El indexador usa por defecto fragmentos de 400 palabras, sin solapamiento, y envía solo los primeros 3000 caracteres JavaScript; conserva el texto completo para contexto. Plugin y MCP difieren en truncado y rotación/fallback. VectorStore almacena float32/base64 en JSONL y hace búsqueda exhaustiva por coseno, seguida de ordenación.

El indexador previo a T-040 es plano y reutiliza por hash de contenido, sin verificar identidad del modelo. Estos son comportamientos existentes, no el resultado de la re-arquitectura. DEC-0022 y T-036/T-040 corrigen permisos antes de ranking, umbrales, identidad y generaciones selladas. Mantener 768 dimensiones al cambiar a un modelo local **no hace compatibles los vectores**: se necesita generación nueva y reindexado completo.

Fuentes del código: `src/embeddings/embed-contract.ts`, `src/embeddings/gemini-balancer.ts`, `mcp-server/src/embeddings/gemini-embed.ts`, `src/projects/indexer.ts`, `src/rag/vector-store.ts`, `mcp-server/src/tools/query-vault.ts`. La investigación leyó la rama de integración antes de integrar T-036/T-040; los archivos evolucionan durante la iniciativa.

## Opciones de ejecución

| Runtime | Evidencia y límite |
|---|---|
| Sentence Transformers en servicio local | Referencia oficial más clara para cargar solo texto; Python/PyTorch, CPU FP32 o GPU BF16 compatible. |
| Ollama `/api/embed` | Soporta lotes, dimensiones y residencia `keep_alive`. Hay tags 270m y 270m-bf16-text; el alias 270m comparte digest con una variante etiquetada MLX. Validar Windows/CUDA antes de recomendar una instalación concreta. |
| llama.cpp / llama-server | Endpoints de embeddings y conversión disponible; verificar versión, GGUF, pooling/proyección y paridad con la referencia antes de seleccionarlo. |

[API Ollama](https://docs.ollama.com/api/embed), [tags](https://ollama.com/library/embeddinggemma-2/tags), [llama-server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md?plain=1). La metadata de Ollama indica 256K mientras Google y el README del registro dicen 8K; usar 8K hasta aclarar la discrepancia. Tamaño de descarga no equivale a consumo máximo.

## Encaje recomendado y prueba pendiente

Es una opción prometedora para privacidad, indexación offline y eliminación de costes/cuotas de embeddings. No vuelve offline el proveedor de chat. Un proceso local puede competir por GPU con el chat: residencia mejora consultas calientes; descarga libera memoria pero encarece el arranque.

Una iniciativa posterior puede añadir un puerto compartido de embeddings con propósito query/document, modelo/revisión, dimensiones, batch y cancelación; adaptadores Gemini y HTTP loopback local. La identidad de generación debe incluir backend/modelo/revisión, precisión o cuantización, prefijos, normalización y fragmentación real. Autorizar antes de enviar texto y validar vectores finitos; no mezclar espacios ni cambiar silenciosamente al proveedor remoto.

Benchmark propuesto: 1000 notas sintéticas bilingües con código y 60 consultas etiquetadas. Comparar Gemini y texto local BF16/FP32 a 768d, con 256d como variante. Medir Recall@5, nDCG@10, abstención ante consultas sin evidencia, p50/p95 frío y caliente, duración de indexación, picos RAM/VRAM e impacto en chat simultáneo. Calibrar de nuevo el umbral 0,65. Elegir backend y llamarlo una excelente opción después de comprobar calidad y presupuestos reales; no usar notas privadas ni registrar credenciales.
