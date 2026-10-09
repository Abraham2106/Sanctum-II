"""Strict loopback HTTP header and JSON request validation."""
from __future__ import annotations

import json
import re
from http.client import HTTPMessage
from typing import Any, Optional, Tuple

from config import ServiceConfig
from identity import has_lone_surrogate, identity_document_valid

MAX_BODY_BYTES = 1 << 20
_EMBED_KEYS = frozenset({"version", "purpose", "texts", "dims", "identity"})

_HOST_RE = re.compile(r"^(?P<host>127\.0\.0\.1|localhost)(?::(?P<port>\d+))?$", re.IGNORECASE)


def header_values(headers: HTTPMessage, name: str) -> list[str]:
    raw = headers.get_all(name) or []
    return [v for v in raw if v is not None]


def _parse_port(port_str: str) -> Optional[int]:
    if not port_str.isdigit():
        return None
    if len(port_str) > 5:
        return None
    value = int(port_str, 10)
    if value < 1 or value > 65535:
        return None
    return value


def host_rejected(headers: HTTPMessage, config: ServiceConfig) -> bool:
    values = header_values(headers, "Host")
    if len(values) != 1:
        return True
    host_field = values[0].strip()
    if not host_field or host_field != values[0]:
        return True
    if any(c in host_field for c in "/?#@"):
        return True
    match = _HOST_RE.match(host_field)
    if not match:
        return True
    host = match.group("host").lower()
    if host not in ("127.0.0.1", "localhost"):
        return True
    port_str = match.group("port")
    if port_str is None:
        port = config.port
    else:
        port = _parse_port(port_str)
        if port is None:
            return True
    return port != config.port


def origin_rejected(headers: HTTPMessage) -> bool:
    return len(header_values(headers, "Origin")) > 0


def bearer_authorized(headers: HTTPMessage, token: str) -> bool:
    values = header_values(headers, "Authorization")
    if len(values) != 1:
        return False
    auth = values[0]
    prefix = "Bearer "
    if not auth.startswith(prefix):
        return False
    supplied = auth[len(prefix) :]
    try:
        import secrets

        return secrets.compare_digest(supplied, token)
    except (TypeError, ValueError):
        return False


def transfer_encoding_rejected(headers: HTTPMessage) -> bool:
    return len(header_values(headers, "Transfer-Encoding")) > 0


def parse_content_length(headers: HTTPMessage) -> Tuple[Optional[int], Optional[str]]:
    values = header_values(headers, "Content-Length")
    if len(values) != 1:
        return None, "INVALID_CONTENT_LENGTH"
    raw = values[0].strip()
    if not raw or raw != values[0]:
        return None, "INVALID_CONTENT_LENGTH"
    if not raw.isdigit():
        return None, "INVALID_CONTENT_LENGTH"
    if len(raw) > 7:
        return None, "INVALID_CONTENT_LENGTH"
    length = int(raw, 10)
    if length > MAX_BODY_BYTES:
        return None, "BODY_TOO_LARGE"
    return length, None


def _json_rejects_non_finite(doc: Any) -> bool:
    if isinstance(doc, float):
        return doc != doc or doc in (float("inf"), float("-inf"))
    if isinstance(doc, dict):
        return any(_json_rejects_non_finite(v) for v in doc.values())
    if isinstance(doc, list):
        return any(_json_rejects_non_finite(v) for v in doc)
    return False


def parse_embed_document(raw: bytes, config: ServiceConfig) -> Tuple[Optional[dict[str, Any]], Optional[str]]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None, "INVALID_JSON"
    if has_lone_surrogate(text):
        return None, "INVALID_JSON"
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        return None, "INVALID_JSON"
    if not isinstance(doc, dict):
        return None, "INVALID_SCHEMA"
    if set(doc.keys()) != _EMBED_KEYS:
        return None, "INVALID_SCHEMA"
    if _json_rejects_non_finite(doc):
        return None, "INVALID_SCHEMA"
    version = doc.get("version")
    if type(version) is not int or isinstance(version, bool) or version != 1:
        return None, "INVALID_SCHEMA"
    purpose = doc.get("purpose")
    texts = doc.get("texts")
    dims = doc.get("dims")
    identity = doc.get("identity")
    if purpose not in ("query", "document"):
        return None, "INVALID_SCHEMA"
    if not isinstance(texts, list) or len(texts) == 0 or len(texts) > 16:
        return None, "INVALID_SCHEMA"
    if not all(isinstance(t, str) for t in texts):
        return None, "INVALID_SCHEMA"
    for t in texts:
        if has_lone_surrogate(t):
            return None, "INVALID_SCHEMA"
    if type(dims) is not int or isinstance(dims, bool) or dims != config.dims:
        return None, "INVALID_SCHEMA"
    if not isinstance(identity, dict):
        return None, "INVALID_SCHEMA"
    if not identity_document_valid(identity):
        return None, "INVALID_SCHEMA"
    return doc, None
