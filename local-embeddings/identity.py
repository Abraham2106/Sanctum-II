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

OUTER_IDENTITY_KEYS = frozenset(
    {"version", "backend", "model", "revision", "dims", "configFingerprint", "descriptor"}
)

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

RUNTIME_KEYS = frozenset({"python", "torch", "transformers", "sentence_transformers"})
PREPROCESSING_KEYS = frozenset({"maxChars", "units", "maxTokens", "overflow"})


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
    if not descriptor_schema_valid(desc):
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


def descriptor_schema_valid(desc: Any) -> bool:
    if not isinstance(desc, dict) or set(desc.keys()) != DESCRIPTOR_KEYS:
        return False
    if desc["backend"] != BACKEND or desc["model"] != MODEL_ID:
        return False
    if type(desc["dims"]) is not int or isinstance(desc["dims"], bool):
        return False
    if desc["dims"] not in ALLOWED_DIMS:
        return False
    if desc["revision"] != desc["tokenizerRevision"]:
        return False
    if not isinstance(desc["revision"], str) or len(desc["revision"]) != 40:
        return False
    if desc["device"] not in ("cpu", "cuda"):
        return False
    if desc["dtype"] not in ("float32", "bfloat16"):
        return False
    if desc["encoders"] != ["text"]:
        return False
    if desc["queryPrefix"] != QUERY_PREFIX or desc["documentPrefix"] != DOCUMENT_PREFIX:
        return False
    if desc["pooling"] != "model-default" or desc["projection"] != "model-default":
        return False
    if desc["normalize"] is not True:
        return False
    prep = desc["preprocessing"]
    if not isinstance(prep, dict) or set(prep.keys()) != PREPROCESSING_KEYS:
        return False
    if prep != {
        "maxChars": PREPROCESS_MAX_UTF16,
        "units": "utf16-code-units",
        "maxTokens": MAX_TOKEN_BUDGET,
        "overflow": "reject",
    }:
        return False
    runtime = desc["runtime"]
    if not isinstance(runtime, dict) or set(runtime.keys()) != RUNTIME_KEYS:
        return False
    if not all(isinstance(runtime[k], str) for k in RUNTIME_KEYS):
        return False
    return True


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


def identity_document_valid(doc: Any) -> bool:
    if not isinstance(doc, dict) or set(doc.keys()) != OUTER_IDENTITY_KEYS:
        return False
    if type(doc["version"]) is not int or isinstance(doc["version"], bool) or doc["version"] != 1:
        return False
    if type(doc["dims"]) is not int or isinstance(doc["dims"], bool):
        return False
    for key in ("backend", "model", "revision", "configFingerprint"):
        if not isinstance(doc[key], str):
            return False
    desc = doc["descriptor"]
    if not descriptor_schema_valid(desc):
        return False
    for key in ("backend", "model", "revision", "dims"):
        if desc[key] != doc[key]:
            return False
    try:
        return config_fingerprint(desc) == doc["configFingerprint"]
    except (TypeError, ValueError, OverflowError):
        return False


def identities_match(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    if not isinstance(expected, dict) or not isinstance(actual, dict):
        return False
    if set(expected.keys()) != OUTER_IDENTITY_KEYS or set(actual.keys()) != OUTER_IDENTITY_KEYS:
        return False
    if type(expected["version"]) is not int or type(actual["version"]) is not int:
        return False
    if expected["version"] != 1 or actual["version"] != 1:
        return False
    if type(expected["dims"]) is not int or type(actual["dims"]) is not int:
        return False
    if isinstance(expected["dims"], bool) or isinstance(actual["dims"], bool):
        return False
    for key in ("backend", "model", "revision", "configFingerprint"):
        if not isinstance(expected[key], str) or not isinstance(actual[key], str):
            return False
        if expected[key] != actual[key]:
            return False
    if expected["dims"] != actual["dims"]:
        return False
    exp_desc = expected["descriptor"]
    act_desc = actual["descriptor"]
    if not descriptor_schema_valid(exp_desc) or not descriptor_schema_valid(act_desc):
        return False
    for key in ("backend", "model", "revision", "dims"):
        if exp_desc[key] != expected[key]:
            return False
        if act_desc[key] != actual[key]:
            return False
    try:
        if config_fingerprint(exp_desc) != expected["configFingerprint"]:
            return False
        if config_fingerprint(act_desc) != actual["configFingerprint"]:
            return False
        return canonical_json_bytes(exp_desc) == canonical_json_bytes(act_desc)
    except (TypeError, ValueError, OverflowError):
        return False
