"""Strict loopback HTTP header and JSON request validation."""
from __future__ import annotations

import json
import re
import secrets
from http.client import HTTPMessage
from typing import Any, Optional, Tuple

from config import ServiceConfig

MAX_BODY_BYTES = 1 << 20
_EMBED_KEYS = frozenset({"version", "purpose", "texts", "dims", "identity"})

_HOST_RE = re.compile(r"^(?P<host>127\.0\.0\.1|localhost)(?::(?P<port>\d+))?$", re.IGNORECASE)


def header_values(headers: HTTPMessage, name: str) -> list[str]:
    raw = headers.get_all(name) or []
    return [v for v in raw if v is not None]


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
    port = int(port_str) if port_str is not None else config.port
    if port < 1 or port > 65535:
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
    try:
        length = int(raw, 10)
    except ValueError:
        return None, "INVALID_CONTENT_LENGTH"
    if length < 0:
        return None, "INVALID_CONTENT_LENGTH"
    if length > MAX_BODY_BYTES:
        return None, "BODY_TOO_LARGE"
    return length, None


def parse_embed_document(raw: bytes, config: ServiceConfig) -> Tuple[Optional[dict[str, Any]], Optional[str]]:
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "INVALID_JSON"
    if not isinstance(doc, dict):
        return None, "INVALID_SCHEMA"
    if set(doc.keys()) != _EMBED_KEYS:
        return None, "INVALID_SCHEMA"
    version = doc.get("version")
    if type(version) is not int or version != 1:
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
    if type(dims) is not int or isinstance(dims, bool) or dims != config.dims:
        return None, "INVALID_SCHEMA"
    if not isinstance(identity, dict):
        return None, "INVALID_SCHEMA"
    return doc, None
