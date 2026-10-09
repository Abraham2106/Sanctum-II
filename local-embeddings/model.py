"""Background load lifecycle and embed request orchestration."""
from __future__ import annotations

import threading
from enum import Enum
from typing import Any, Callable, List, Optional, Sequence

from config import (
    ERROR_DEPENDENCY_MISSING,
    ERROR_INVALID_REVISION,
    ERROR_LOAD_FAILED,
    ERROR_MODEL_NOT_INSTALLED,
    ERROR_UNSUPPORTED_DTYPE,
    ServiceConfig,
    configured_for_load,
    validate_bind_config,
    validate_operational_config,
)
from identity import (
    MAX_TOKEN_BUDGET,
    PREPROCESS_MAX_UTF16,
    identities_match,
    purpose_prefix,
    utf16_code_unit_len,
)
from runtime import ModelRuntime
from vectors import coerce_embedding_rows

MAX_BATCH = 16
MAX_BODY_BYTES = 1 << 20

LOAD_ERRORS = frozenset(
    {
        ERROR_DEPENDENCY_MISSING,
        ERROR_INVALID_REVISION,
        ERROR_UNSUPPORTED_DTYPE,
        ERROR_LOAD_FAILED,
        ERROR_MODEL_NOT_INSTALLED,
    }
)


class LoadState(str, Enum):
    UNCONFIGURED = "unconfigured"
    LOADING = "loading"
    READY = "ready"
    FAILED = "failed"


_lock = threading.Lock()
_load_state = LoadState.UNCONFIGURED
_failure_code: Optional[str] = None
_identity: Optional[dict[str, Any]] = None
_runtime: Optional[ModelRuntime] = None
_load_thread: Optional[threading.Thread] = None
_infer_lock = threading.Lock()


def sanitize_load_error(exc: BaseException) -> str:
    if isinstance(exc, RuntimeError):
        code = str(exc)
        if code in LOAD_ERRORS:
            return code
    return ERROR_LOAD_FAILED


def get_load_state() -> LoadState:
    return _load_state


def get_failure_code() -> Optional[str]:
    return _failure_code


def get_identity() -> Optional[dict[str, Any]]:
    return _identity


def get_runtime() -> Optional[ModelRuntime]:
    return _runtime


def _set_failed(code: str) -> None:
    global _load_state, _failure_code, _identity, _runtime
    safe = code if code in LOAD_ERRORS else ERROR_LOAD_FAILED
    _load_state = LoadState.FAILED
    _failure_code = safe
    _identity = None
    _runtime = None


def _load_worker(
    config: ServiceConfig,
    runtime_factory: Callable[[ServiceConfig], Any],
) -> None:
    global _load_state, _failure_code, _identity, _runtime
    pre = validate_operational_config(config)
    if pre:
        _set_failed(pre)
        return
    try:
        runtime = runtime_factory(config)
        identity = runtime.load()
    except Exception as exc:
        _set_failed(sanitize_load_error(exc))
        return
    with _lock:
        _runtime = runtime
        _identity = identity
        _failure_code = None
        _load_state = LoadState.READY


def start_background_load(
    config: ServiceConfig,
    runtime_factory: Optional[Callable[[ServiceConfig], Any]] = None,
) -> None:
    global _load_state, _load_thread, _failure_code
    try:
        validate_bind_config(config)
    except ValueError:
        _load_state = LoadState.UNCONFIGURED
        _failure_code = None
        return
    if not configured_for_load(config):
        _load_state = LoadState.UNCONFIGURED
        _failure_code = None
        return
    factory = runtime_factory or ModelRuntime
    with _lock:
        if _load_state in (LoadState.LOADING, LoadState.READY):
            return
        _load_state = LoadState.LOADING
        _failure_code = None
        _load_thread = threading.Thread(
            target=_load_worker,
            args=(config, factory),
            name="sanctum-embed-load",
            daemon=True,
        )
        _load_thread.start()


def join_background_load(timeout: float = 30.0) -> bool:
    thread = _load_thread
    if thread is None:
        return True
    thread.join(timeout=timeout)
    return not thread.is_alive()


def reset_service_state_for_tests() -> None:
    global _load_state, _failure_code, _identity, _runtime, _load_thread
    with _lock:
        _load_state = LoadState.UNCONFIGURED
        _failure_code = None
        _identity = None
        _runtime = None
        _load_thread = None


def embed_request(
    config: ServiceConfig,
    purpose: str,
    texts: Sequence[str],
    client_identity: dict[str, Any],
) -> List[List[float]]:
    if _load_state != LoadState.READY or _runtime is None or _identity is None:
        raise RuntimeError("NOT_READY")
    if not identities_match(_identity, client_identity):
        raise ValueError("IDENTITY_MISMATCH")
    if purpose not in ("query", "document"):
        raise ValueError("INVALID_PURPOSE")
    if len(texts) > MAX_BATCH or len(texts) == 0:
        raise ValueError("INVALID_BATCH")
    if client_identity.get("dims") != config.dims:
        raise ValueError("IDENTITY_MISMATCH")

    if not _infer_lock.acquire(blocking=False):
        raise RuntimeError("BUSY")
    try:
        prefix = purpose_prefix(purpose)
        for text in texts:
            if not isinstance(text, str):
                raise ValueError("INVALID_TEXT")
            if utf16_code_unit_len(text) > PREPROCESS_MAX_UTF16:
                raise ValueError("TEXT_TOO_LONG")
            token_count = _runtime.count_tokens(prefix + text)
            if token_count > MAX_TOKEN_BUDGET:
                raise ValueError("TOKEN_BUDGET_EXCEEDED")

        vectors = _runtime.embed(texts, purpose)
        if len(vectors) != len(texts):
            raise ValueError("INVALID_BATCH")
        return coerce_embedding_rows(vectors, len(texts), config.dims)
    except Exception:
        raise
    finally:
        _infer_lock.release()
