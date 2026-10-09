# DEC-0023 — Infraestructura opcional de embeddings locales de texto

- Status: accepted
- Date: 2026-10-08
- Decider: coordinador, por nueva instrucción explícita del usuario
- Supersedes: exclusión de embeddings locales de REQ-0002/DEC-0022 y restricción Gemini-only de DEC-0005, exclusivamente para este backend opcional

## Alcance y ejecución

Gemini sigue como default. Añadir backend explícito `sentence-transformers` compartido por plugin/MCP, con servicio Python iniciado manualmente. No activar por el nombre de modelo; no fallback remoto ante fallo local. Sin otra base de datos, rediseño visual, administrador de procesos, instalación automática ni descarga automática de pesos. Se conserva el resto de DEC-0022.

Modelo admitido: `google/embeddinggemma-2`, revisión inmutable de 40 caracteres hexadecimales, solo texto. Cargar `vision_config=None`, `audio_config=None`, `local_files_only=True`, `trust_remote_code=False`. CPU FP32 por defecto; CUDA BF16 explícito y solo si soportado; FP16 rechazado. El servicio obtiene los pesos de cache local existente y verifica la revisión. No hay modelo sintético ni flag de fallback en producción.

## Puerto, preparación e identidad

Nuevo `src/runtime/embedding.ts`: propósito `query|document`, dimensiones, identidad, batch opcional, health y cancelación; `EmbedderPort.embed(text, options?)` recibe opciones extendidas. `hasKeys` queda alias compatible de proveedor configurado, sin exigir claves Gemini en modo local.

Identidad JSON: `{version:1,backend,model,revision,dims,configFingerprint,descriptor}`. Descriptor efectivo incluye versiones de runtime/librerías, precisión/dispositivo, encoders de texto, revisión de tokenizer, prefijos, pooling/proyección, normalización y preparación/truncado. Fingerprint SHA-256 de JSON canónico con claves ordenadas, UTF-8, sin espacios. Backend, modelo, revisión y dimensiones se comprueban junto al hash. Token, puerto, timeout y scheduling no integran identidad.

Descriptor local exacto (todos los campos obligatorios; sin campos extra):

```json
{
  "backend": "sentence-transformers",
  "model": "google/embeddinggemma-2",
  "revision": "<40 hex lowercase>",
  "dims": 768,
  "runtime": {"python":"<version>","torch":"<version>","transformers":"<version>","sentence_transformers":"<version>"},
  "device": "cpu",
  "dtype": "float32",
  "encoders": ["text"],
  "tokenizerRevision": "<same immutable revision>",
  "queryPrefix": "task: search result | query: ",
  "documentPrefix": "title: none | text: ",
  "pooling": "model-default",
  "projection": "model-default",
  "normalize": true,
  "preprocessing": {"maxChars":3000,"units":"utf16-code-units","maxTokens":8192,"overflow":"reject"}
}
```

device admite cpu/cuda; dtype float32/bfloat16, combinaciones conforme política anterior. dims admite las cuatro dimensiones locales. Fingerprint incluye precisamente este objeto. Gemini usa el mismo shape con backend gemini, revisión `api`, runtime `{adapter:"gemini-v1"}`, device remote, dtype provider, tokenizerRevision provider-managed, prefijos vacíos, normalize false (coseno), maxTokens null y overflow provider; sin pretender revisionar internamente la API remota. La identidad exterior debe coincidir con sus campos duplicados en descriptor.

Prefijos locales exactos, aplicados una sola vez mediante prompt explícito de encode: query `task: search result | query: `; document `title: none | text: `. Normalización L2 obligatoria. Dimensiones locales configuradas al iniciar: 768/512/256/128; cada petición debe coincidir. Preparación compartida en cliente: primeros 3000 code units UTF-16, registrada en descriptor; servidor no añade un segundo truncado. Rechazar entradas que superen 8192 tokens contando prefijo/tokens especiales, sin truncado implícito adicional.

Vectors: batch ordenado y atómico, cantidad exacta, números finitos (booleanos no), dimensión exacta y norma no nula. Proyecto y generación se mantienen separados de identidad del proveedor. Comparación pública de recuperación verifica también fingerprint. Gemini usa adaptador explícito hacia el mismo puerto; mantiene overload compatible modelo/dimensiones, sin fallback entre modelos cuando se fija identidad.

## Wire y ciclo de vida local

Python standard-library HTTP server, bind exclusivamente `127.0.0.1`. Cliente configurado por puerto numérico, no URL arbitraria; prohibir redirects. Transporte Node HTTP compartido en desktop/MCP, inyectado fuera del núcleo, sin seguir redirects y con abort físico del socket. Fetch opcional debe usar redirect:error; no depender de fetch del renderer ni de redirects implícitos de requestUrl. Token Bearer obligatorio desde entorno/configuración global, comparación constante. Rechazar todo Origin y Host ajeno. Sin CORS. Proteger health con token y no registrar texto/tokens/rutas privadas.

- `GET /health`: `{version:1,state,code?,identity?}`; estados unconfigured/loading/ready/failed. ready solo después de carga real y probe sintético de vector finito, nunca por un doble de producción.
- `POST /embed`: `{version:1,purpose,texts,dims,identity}` -> `{version:1,identity,embeddings}`.
- Máximo 1 MiB, batch 16, un inference activo; rechazar busy sin cola ilimitada. Validar schema/identidad antes de inferir. No aceptar paths/modelos/URLs por petición.
- Health timeout 5s, embedding default 120s limitado/configurable. Fetch aborta transporte; requestUrl solo cancelación lógica y descarta respuesta tardía. Ninguno promete interrumpir kernels PyTorch ya iniciados. Limpiar timers.
- Imports opcionales diferidos. Errores sanitizados DEPENDENCY_MISSING/MODEL_NOT_INSTALLED/INVALID_REVISION/UNSUPPORTED_DTYPE/LOAD_FAILED. Health disponible durante carga/fallo cuando configuración de bind/token es válida.

## Configuración e integración

Proyecto puede declarar `embedding?: {backend,model,revision,dims}`; ausencia hereda global. Campos rag existentes conservados para Gemini y top-k/threshold/chunking. Endpoint/token solo global, nunca YAML de proyecto. Settings/env agregan backend, revisión, puerto y token. Settings: embeddingBackend/localEmbeddingPort/localEmbeddingToken/localEmbeddingRevision/localEmbeddingDims. Env: SANCTUM_EMBED_BACKEND, SANCTUM_LOCAL_EMBED_PORT, SANCTUM_LOCAL_EMBED_TOKEN, SANCTUM_LOCAL_EMBED_REVISION, SANCTUM_LOCAL_EMBED_DIMS, SANCTUM_LOCAL_EMBED_DEVICE, SANCTUM_LOCAL_EMBED_DTYPE. Default puerto 8767/dims 768/backend Gemini. Snapshot completo por ejecución/reconstrucción.

Generaciones guardan descriptor/identidad reales y fingerprint junto a chunking. Cambio de backend/modelo/revisión/configuración exige reconstrucción explícita completa; conservar índices previos. No consultar un índice local como Gemini. El reader valida identidad antes de comparar y el cliente revalida respuesta/health. Permisos antes de transmitir texto. Generación incompleta o fallo/timeout no publica ni reemplaza activa.

Interfaz conserva apariencia, añade controles de proveedor y estados loading/missing runtime/auth/config mismatch/rebuild required. No presentar embeddings offline como chat offline. Umbral local configurable, calidad sin calibrar hasta benchmark sintético.

## Propiedad y evidencia

T-050: sidecar Python/README/tests nuevos, sin tocar TS. T-049: puerto/cliente/config compartidos, tipos/settings/env y serialización de selección de proyecto; propiedad serial después de T-036/T-038/T-047/T-048/T-051. T-040 consume puerto y generación, T-041 MCP, T-042 plugin, T-043 controles, T-044 docs/CI. T-045 modifica turn primero para chat; T-049 lo recibe después solo para embeddings. Nunca escritores simultáneos.

Composer 2.5 headless implementa; Sol 6.1 revisa. TS/Python tests con dobles explícitos exclusivamente de contrato y HTTP real de loopback. Probar auth/Origin/Host/límites, errores/readiness, valores inválidos, batch, identidad, cancelación, no fallback y migración. Sin pesos/dependencias disponibles: integración real pendiente, no producción. Benchmark de RESEARCH-embeddinggemma-2 sigue pendiente; no garantizar VRAM/latencia/calidad.
