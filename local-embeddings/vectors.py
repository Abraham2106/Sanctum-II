"""Embedding vector validation (post-encode, pre-response)."""
from __future__ import annotations

import math
from typing import Any, List, Sequence

L2_TOLERANCE = 0.02
_MAX_COMPONENT = 1e37


def _sequence_from_row(row: Any) -> List[Any]:
    if hasattr(row, "tolist"):
        return list(row.tolist())
    if isinstance(row, Sequence) and not isinstance(row, (str, bytes, bytearray)):
        return list(row)
    raise ValueError("INVALID_VECTOR_VALUE")


def _numeric_value(v: Any) -> float:
    if type(v) is bool:
        raise ValueError("INVALID_VECTOR_VALUE")
    if isinstance(v, int):
        if abs(v) > _MAX_COMPONENT:
            raise ValueError("INVALID_VECTOR_VALUE")
        return float(v)
    if isinstance(v, float):
        if not math.isfinite(v) or abs(v) > _MAX_COMPONENT:
            raise ValueError("INVALID_VECTOR_VALUE")
        return v
    raise ValueError("INVALID_VECTOR_VALUE")


def _l2_normalize(vec: List[float]) -> List[float]:
    norm_sq = math.fsum(x * x for x in vec)
    if not math.isfinite(norm_sq) or norm_sq == 0.0:
        raise ValueError("INVALID_VECTOR_NORM")
    norm = math.sqrt(norm_sq)
    if not math.isfinite(norm) or norm == 0.0:
        raise ValueError("INVALID_VECTOR_NORM")
    return [x / norm for x in vec]


def coerce_embedding_rows(raw: Any, expected_count: int, dims: int) -> List[List[float]]:
    if raw is None:
        raise ValueError("INVALID_VECTOR_VALUE")
    try:
        rows = list(raw)
    except TypeError:
        raise ValueError("INVALID_VECTOR_VALUE")
    if len(rows) != expected_count:
        raise ValueError("INVALID_BATCH")

    out: List[List[float]] = []
    for row in rows:
        seq = _sequence_from_row(row)
        if len(seq) != dims:
            raise ValueError("INVALID_VECTOR_DIM")
        converted = [_numeric_value(v) for v in seq]
        norm_sq = math.fsum(x * x for x in converted)
        if not math.isfinite(norm_sq) or norm_sq == 0.0:
            raise ValueError("INVALID_VECTOR_NORM")
        norm = math.sqrt(norm_sq)
        if not math.isfinite(norm) or norm == 0.0:
            raise ValueError("INVALID_VECTOR_NORM")
        if abs(norm - 1.0) <= L2_TOLERANCE:
            out.append(converted)
        else:
            out.append(_l2_normalize(converted))
    return out
