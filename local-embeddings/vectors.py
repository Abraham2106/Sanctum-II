"""Embedding vector validation (post-encode, pre-response)."""
from __future__ import annotations

import math
from typing import Any, List, Sequence


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
        if hasattr(row, "tolist"):
            seq = row.tolist()
        elif isinstance(row, Sequence):
            seq = list(row)
        else:
            raise ValueError("INVALID_VECTOR_VALUE")
        if len(seq) != dims:
            raise ValueError("INVALID_VECTOR_DIM")
        converted: List[float] = []
        norm_sq = 0.0
        for v in seq:
            if type(v) is bool or not isinstance(v, (int, float)):
                raise ValueError("INVALID_VECTOR_VALUE")
            fv = float(v)
            if not math.isfinite(fv):
                raise ValueError("INVALID_VECTOR_VALUE")
            converted.append(fv)
            norm_sq += fv * fv
        if norm_sq == 0.0:
            raise ValueError("INVALID_VECTOR_NORM")
        out.append(converted)
    return out
