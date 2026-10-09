# Sanctum local text embeddings (DEC-0023)

Manual Python sidecar for `google/embeddinggemma-2` via `sentence-transformers`. Binds **only** `127.0.0.1`, default port **8767**. No auto-install, no weight downloads, no production test doubles. Live inference with real weights remains operator-verified; dependency pins in `requirements.txt` do not by themselves guarantee model compatibility.

## Environment

| Variable | Purpose |
|---|---|
| `SANCTUM_LOCAL_EMBED_TOKEN` | Required bearer token |
| `SANCTUM_LOCAL_EMBED_REVISION` | Required **40-character lowercase hex** Hugging Face revision |
| `SANCTUM_LOCAL_EMBED_DIMS` | `768`, `512`, `256`, or `128` (MRL + L2 via `truncate_dim` + `normalize_embeddings`) |
| `SANCTUM_LOCAL_EMBED_PORT` | Default `8767` |
| `SANCTUM_LOCAL_EMBED_DEVICE` | `cpu` or `cuda` |
| `SANCTUM_LOCAL_EMBED_DTYPE` | `float32` on CPU; `bfloat16` on CUDA only |

Load uses a **verified local HF cache snapshot** (`snapshots/<revision>/`), `local_files_only=True` and `trust_remote_code=False` at the SentenceTransformer top level, `vision_config=None`, `audio_config=None`.

## Identity descriptor (exact)

Fingerprint = SHA-256 of canonical JSON (`sort_keys`, `separators=(',',':')`, `ensure_ascii=False`, `allow_nan=False`) over:

```json
{
  "backend": "sentence-transformers",
  "model": "google/embeddinggemma-2",
  "revision": "<40 hex lowercase>",
  "dims": 768,
  "runtime": {
    "python": "<version>",
    "torch": "<version>",
    "transformers": "<version>",
    "sentence_transformers": "<version>"
  },
  "device": "cpu",
  "dtype": "float32",
  "encoders": ["text"],
  "tokenizerRevision": "<same revision>",
  "queryPrefix": "task: search result | query: ",
  "documentPrefix": "title: none | text: ",
  "pooling": "model-default",
  "projection": "model-default",
  "normalize": true,
  "preprocessing": {
    "maxChars": 3000,
    "units": "utf16-code-units",
    "maxTokens": 8192,
    "overflow": "reject"
  }
}
```

Outer identity: `{version:1, backend, model, revision, dims, configFingerprint, descriptor}` with duplicated scalar fields matching the descriptor.

## Wire

- `GET /health` → `{version:1,state,code?,identity?}`
- `POST /embed` → `{version:1,purpose,texts,dims,identity}` → `{version:1,identity,embeddings}`

Strict loopback Host (`127.0.0.1` or `localhost` with matching port only), reject any `Origin`, mandatory Bearer, 1 MiB body cap, batch ≤ 16, single active inference (`BUSY`).

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

Uses real stdlib HTTP against `127.0.0.1` with **test-only** `FakeRuntime`. Loopback may fail in restricted sandboxes (e.g. Windows `WinError 10013`); that is environmental, not a contract failure.
