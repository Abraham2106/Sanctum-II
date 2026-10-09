# Sanctum local text embeddings (DEC-0023)

Manual Python sidecar for `google/embeddinggemma-2` via `sentence-transformers`. Binds **only** `127.0.0.1`, default port **8767**. No auto-install, no weight downloads, no production test doubles.

**Live inference status:** operator must install compatible `sentence-transformers` / `torch` / `transformers` manually and place the model in the local Hugging Face cache at the configured immutable revision. Until that is done, expect `DEPENDENCY_MISSING` or `MODEL_NOT_INSTALLED` on smoke/health — contract tests use mocks only.

## Environment

| Variable | Purpose |
|---|---|
| `SANCTUM_LOCAL_EMBED_TOKEN` | Required bearer token |
| `SANCTUM_LOCAL_EMBED_REVISION` | Required **40-character lowercase hex** Hugging Face revision |
| `SANCTUM_LOCAL_EMBED_DIMS` | `768`, `512`, `256`, or `128` |
| `SANCTUM_LOCAL_EMBED_PORT` | Default `8767` (digits only) |
| `SANCTUM_LOCAL_EMBED_DEVICE` | `cpu` or `cuda` |
| `SANCTUM_LOCAL_EMBED_DTYPE` | `float32` on CPU; `bfloat16` on CUDA only |

## Identity descriptor (exact DEC-0023)

See root `docs/design/DEC-0023-local-text-embeddings.md` for the frozen JSON shape and fingerprint rules.

## PowerShell

```powershell
$env:SANCTUM_LOCAL_EMBED_TOKEN = "<token>"
$env:SANCTUM_LOCAL_EMBED_REVISION = "<40-char-lowercase-hex>"
$env:SANCTUM_LOCAL_EMBED_DIMS = "768"
python local-embeddings/server.py --smoke
python local-embeddings/server.py
```

## Tests

```powershell
python -m unittest discover -s local-embeddings -p "test_*.py"
```

Stdlib HTTP loopback with **test-only** `FakeRuntime`. Restricted sandboxes may block binds (`WinError 10013`); that is environmental.
