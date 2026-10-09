"""Test-only fakes for local-embeddings (not used in production)."""
from __future__ import annotations

import math
from typing import List, Sequence

from config import ServiceConfig
from identity import build_identity, purpose_prefix
from vectors import coerce_embedding_rows


class FakeTokenizer:
    def __init__(self) -> None:
        self.last_truncation: bool | None = None

    def encode(self, text: str, add_special_tokens: bool = True, truncation: bool = False) -> List[int]:
        self.last_truncation = truncation
        return list(range(max(1, len(text) // 4)))


class FakeRuntime:
    """Deterministic embedder for HTTP contract tests (no torch)."""

    def __init__(self, config: ServiceConfig) -> None:
        self._config = config
        self._tokenizer = FakeTokenizer()
        self.invalid_vectors = False
        self.last_encode_prompt: str | None = None

    def count_tokens(self, text: str) -> int:
        return len(
            self._tokenizer.encode(text, add_special_tokens=True, truncation=False)
        )

    def embed(self, texts: Sequence[str], purpose: str) -> List[List[float]]:
        prefix = purpose_prefix(purpose)
        self.last_encode_prompt = prefix
        raw: List[List[float]] = []
        for idx, _text in enumerate(texts):
            if self.invalid_vectors:
                raw.append([float("nan")] * self._config.dims)
            else:
                row = [0.0] * 768
                row[0] = float(idx + 1)
                row[1] = 0.5
                raw.append(row)
        truncated = [r[: self._config.dims] for r in raw]
        normalized = []
        for row in truncated:
            norm = math.sqrt(sum(x * x for x in row))
            normalized.append([x / norm for x in row])
        return coerce_embedding_rows(normalized, len(texts), self._config.dims)

    def probe(self) -> None:
        self.embed(["probe"], "query")

    def load(self) -> dict:
        runtime = {
            "python": "3.12.0",
            "torch": "2.0.0",
            "transformers": "4.40.0",
            "sentence_transformers": "3.0.0",
        }
        return build_identity(
            self._config.revision,
            self._config.dims,
            self._config.device,
            self._config.dtype,
            runtime,
        )


def sample_revision() -> str:
    return "a" * 40


def base_env() -> dict[str, str]:
    return {
        "SANCTUM_LOCAL_EMBED_TOKEN": "test-token-value",
        "SANCTUM_LOCAL_EMBED_REVISION": sample_revision(),
        "SANCTUM_LOCAL_EMBED_DIMS": "768",
        "SANCTUM_LOCAL_EMBED_PORT": "8767",
    }
