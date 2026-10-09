"""DEC-0023 identity descriptor and canonical fingerprint."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

BACKEND = "sentence-transformers"
MODEL_ID = "google/embeddinggemma-2"
QUERY_PREFIX = "task: search result | query: "
DOCUMENT_PREFIX = "title: none | text: "
ALLOWED_DIMS = frozenset({768, 512, 256, 128})
MAX_TOKEN_BUDGET = 8192
PREPROCESS_MAX_UTF16 = 3000

DESCRIPTOR_KEYS = frozenset(
    {
        "backend",
        "model",
        "revision",
        "dims",
        "runtime",
        "device",
        "dtype",
        "encoders",
        "tokenizerRevision",
        "queryPrefix",
        "documentPrefix",
        "pooling",
        "projection",
        "normalize",
        "preprocessing",
    }
)


def canonical_json_bytes(obj: Any) -> bytes:
    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def config_fingerprint(descriptor: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json_bytes(dict(descriptor))).hexdigest()


def build_descriptor(
    revision: str,
    dims: int,
    device: str,
    dtype: str,
    runtime: dict[str, str],
) -> dict[str, Any]:
    desc: dict[str, Any] = {
        "backend": BACKEND,
        "model": MODEL_ID,
        "revision": revision,
        "dims": dims,
        "runtime": {
            "python": runtime["python"],
            "torch": runtime["torch"],
            "transformers": runtime["transformers"],
            "sentence_transformers": runtime["sentence_transformers"],
        },
        "device": device,
        "dtype": dtype,
        "encoders": ["text"],
        "tokenizerRevision": revision,
        "queryPrefix": QUERY_PREFIX,
        "documentPrefix": DOCUMENT_PREFIX,
        "pooling": "model-default",
        "projection": "model-default",
        "normalize": True,
        "preprocessing": {
            "maxChars": PREPROCESS_MAX_UTF16,
            "units": "utf16-code-units",
            "maxTokens": MAX_TOKEN_BUDGET,
            "overflow": "reject",
        },
    }
    if set(desc.keys()) != DESCRIPTOR_KEYS:
        raise ValueError("descriptor shape")
    return desc


def build_identity(
    revision: str,
    dims: int,
    device: str,
    dtype: str,
    runtime: dict[str, str],
) -> dict[str, Any]:
    descriptor = build_descriptor(revision, dims, device, dtype, runtime)
    fp = config_fingerprint(descriptor)
    return {
        "version": 1,
        "backend": BACKEND,
        "model": MODEL_ID,
        "revision": revision,
        "dims": dims,
        "configFingerprint": fp,
        "descriptor": descriptor,
    }


def purpose_prefix(purpose: str) -> str:
    if purpose == "query":
        return QUERY_PREFIX
    if purpose == "document":
        return DOCUMENT_PREFIX
    raise ValueError("INVALID_PURPOSE")


def validate_revision_string(revision: str) -> str:
    if len(revision) != 40:
        raise ValueError("INVALID_REVISION")
    if revision != revision.lower():
        raise ValueError("INVALID_REVISION")
    if not all(c in "0123456789abcdef" for c in revision):
        raise ValueError("INVALID_REVISION")
    return revision


def has_lone_surrogate(text: str) -> bool:
    for ch in text:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:
            return True
    return False


def utf16_code_unit_len(text: str) -> int:
    if has_lone_surrogate(text):
        raise ValueError("INVALID_TEXT")
    length = 0
    for ch in text:
        length += 2 if ord(ch) > 0xFFFF else 1
    return length


def identities_match(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    if expected.get("version") != 1 or actual.get("version") != 1:
        return False
    if type(expected.get("version")) is not int or type(actual.get("version")) is not int:
        return False
    for key in ("backend", "model", "revision", "dims", "configFingerprint"):
        if expected.get(key) != actual.get(key):
            return False
    if type(expected.get("dims")) is not int or type(actual.get("dims")) is not int:
        return False
    exp_desc = expected.get("descriptor")
    act_desc = actual.get("descriptor")
    if not isinstance(exp_desc, dict) or not isinstance(act_desc, dict):
        return False
    return canonical_json_bytes(exp_desc) == canonical_json_bytes(act_desc)
