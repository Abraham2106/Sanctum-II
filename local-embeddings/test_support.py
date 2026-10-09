"""Test-only fakes for local-embeddings (not used in production)."""
from __future__ import annotations

from typing import List, Sequence

from config import ServiceConfig
from identity import build_identity, purpose_prefix
from vectors import coerce_embedding_rows


class FakeTokenizer:
    def __init__(self) -> None:
        self.last_truncation: bool | None = None
        self.fail_encode = False

    def encode(self, text: str, add_special_tokens: bool = True, truncation: bool = False) -> List[int]:
        self.last_truncation = truncation
        if self.fail_encode:
            raise RuntimeError("tokenizer failed")
        return list(range(max(1, len(text) // 4)))


class FakeRuntime:
    """Deterministic embedder for HTTP contract tests (no torch)."""

    def __init__(self, config: ServiceConfig) -> None:
        self._config = config
        self._tokenizer = FakeTokenizer()
        self.invalid_vectors = False
        self.last_encode_prompt: str | None = None
        self.return_wrong_count = False
        self.return_non_unit = False

    def count_tokens(self, text: str) -> int:
        return len(
            self._tokenizer.encode(text, add_special_tokens=True, truncation=False)
        )

    def embed(self, texts: Sequence[str], purpose: str) -> List[List[float]]:
        prefix = purpose_prefix(purpose)
        self.last_encode_prompt = prefix
        if self.return_wrong_count:
            texts = list(texts) + ["extra"]
        raw: List[List[float]] = []
        for idx, _text in enumerate(texts):
            if self.invalid_vectors:
                raw.append([float("nan")] * self._config.dims)
            elif self.return_non_unit:
                row = [2.0] + [0.0] * (self._config.dims - 1)
                raw.append(row)
            else:
                row = [0.0] * self._config.dims
                row[0] = float(idx + 1)
                row[1] = 0.5
                norm = (row[0] ** 2 + row[1] ** 2) ** 0.5
                raw.append([x / norm for x in row])
        return coerce_embedding_rows(raw, len(texts), self._config.dims)

    def probe(self) -> None:
        for purpose in ("query", "document"):
            prefix = purpose_prefix(purpose)
            self.count_tokens(prefix + "sanctum readiness probe")
        self.embed(["sanctum readiness probe"], "query")
        self.embed(["sanctum readiness probe"], "document")

    def load(self) -> dict:
        return build_identity(
            self._config.revision,
            self._config.dims,
            self._config.device,
            self._config.dtype,
            sample_runtime(),
        )


def sample_revision() -> str:
    return "a" * 40


def sample_runtime() -> dict[str, str]:
    return {
        "python": "3.12.0",
        "torch": "2.0.0",
        "transformers": "4.40.0",
        "sentence_transformers": "3.0.0",
    }


def base_env() -> dict[str, str]:
    return {
        "SANCTUM_LOCAL_EMBED_TOKEN": "test-token-value",
        "SANCTUM_LOCAL_EMBED_REVISION": sample_revision(),
        "SANCTUM_LOCAL_EMBED_DIMS": "768",
        "SANCTUM_LOCAL_EMBED_PORT": "8767",
    }
