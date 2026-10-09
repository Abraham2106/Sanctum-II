"""Production ModelRuntime (sentence-transformers, offline snapshot)."""
from __future__ import annotations

import sys
from typing import Any, List, Sequence

from config import (
    ERROR_DEPENDENCY_MISSING,
    ERROR_INVALID_REVISION,
    ERROR_LOAD_FAILED,
    ERROR_MODEL_NOT_INSTALLED,
    ERROR_UNSUPPORTED_DTYPE,
    ServiceConfig,
    validate_operational_config,
)
from identity import MAX_TOKEN_BUDGET, build_identity, purpose_prefix, validate_revision_string
from snapshot import snapshot_path_for_revision
from vectors import coerce_embedding_rows

MIN_SEQ_LEN = 8192
_PROBE_TEXT = "sanctum readiness probe"


class ModelRuntime:
    def __init__(self, config: ServiceConfig) -> None:
        self._config = config
        self._model = None
        self._tokenizer = None
        self._dtype = "float32"

    def count_tokens(self, text: str) -> int:
        assert self._tokenizer is not None
        encoded = self._tokenizer.encode(
            text,
            add_special_tokens=True,
            truncation=False,
        )
        return len(encoded)

    def embed(self, texts: Sequence[str], purpose: str) -> List[List[float]]:
        assert self._model is not None
        prefix = purpose_prefix(purpose)
        raw = self._model.encode(
            list(texts),
            prompt=prefix,
            truncate_dim=self._config.dims,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return coerce_embedding_rows(raw, len(texts), self._config.dims)

    def probe(self) -> None:
        for purpose in ("query", "document"):
            prefix = purpose_prefix(purpose)
            token_count = self.count_tokens(prefix + _PROBE_TEXT)
            if token_count > MAX_TOKEN_BUDGET:
                raise RuntimeError(ERROR_LOAD_FAILED)
        self.embed([_PROBE_TEXT], "query")
        self.embed([_PROBE_TEXT], "document")

    def load(self) -> dict[str, Any]:
        err = validate_operational_config(self._config)
        if err:
            raise RuntimeError(err)
        try:
            rev = validate_revision_string(self._config.revision)
        except ValueError:
            raise RuntimeError(ERROR_INVALID_REVISION)

        try:
            import sentence_transformers  # noqa: F401
            import torch
            import transformers
            from sentence_transformers import SentenceTransformer
        except ImportError:
            raise RuntimeError(ERROR_DEPENDENCY_MISSING)

        dtype = self._config.dtype
        if self._config.device == "cuda":
            if not torch.cuda.is_bf16_supported():
                raise RuntimeError(ERROR_UNSUPPORTED_DTYPE)
            torch_dtype = torch.bfloat16
        else:
            torch_dtype = torch.float32
        self._dtype = dtype

        try:
            local_path = snapshot_path_for_revision(rev)
        except OSError:
            raise RuntimeError(ERROR_MODEL_NOT_INSTALLED)

        try:
            model = SentenceTransformer(
                local_path,
                device=self._config.device,
                local_files_only=True,
                trust_remote_code=False,
                model_kwargs={
                    "torch_dtype": torch_dtype,
                    "local_files_only": True,
                    "trust_remote_code": False,
                },
                config_kwargs={
                    "vision_config": None,
                    "audio_config": None,
                },
            )
        except OSError:
            raise RuntimeError(ERROR_MODEL_NOT_INSTALLED)
        except Exception:
            raise RuntimeError(ERROR_LOAD_FAILED)

        if getattr(model, "max_seq_length", 0) < MIN_SEQ_LEN:
            model.max_seq_length = MIN_SEQ_LEN

        tokenizer = model.tokenizer
        self._model = model
        self._tokenizer = tokenizer
        try:
            self.probe()
        except Exception:
            self._model = None
            self._tokenizer = None
            raise RuntimeError(ERROR_LOAD_FAILED)

        import sentence_transformers as st

        runtime_versions = {
            "python": sys.version.split()[0],
            "torch": getattr(torch, "__version__", "unknown"),
            "transformers": getattr(transformers, "__version__", "unknown"),
            "sentence_transformers": getattr(st, "__version__", "unknown"),
        }
        return build_identity(rev, self._config.dims, self._config.device, dtype, runtime_versions)
