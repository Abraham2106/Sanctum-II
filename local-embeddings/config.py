"""Service configuration from environment (DEC-0023)."""
from __future__ import annotations

import os
from dataclasses import dataclass

from identity import ALLOWED_DIMS, validate_revision_string

ERROR_DEPENDENCY_MISSING = "DEPENDENCY_MISSING"
ERROR_INVALID_REVISION = "INVALID_REVISION"
ERROR_UNSUPPORTED_DTYPE = "UNSUPPORTED_DTYPE"
ERROR_LOAD_FAILED = "LOAD_FAILED"
ERROR_MODEL_NOT_INSTALLED = "MODEL_NOT_INSTALLED"


@dataclass(frozen=True)
class ServiceConfig:
    host: str = "127.0.0.1"
    port: int = 8767
    token: str = ""
    revision: str = ""
    dims: int = 768
    device: str = "cpu"
    dtype: str = "float32"

    @staticmethod
    def from_env() -> "ServiceConfig":
        port = int(os.environ.get("SANCTUM_LOCAL_EMBED_PORT", "8767"))
        token = os.environ.get("SANCTUM_LOCAL_EMBED_TOKEN", "")
        revision = os.environ.get("SANCTUM_LOCAL_EMBED_REVISION", "").strip()
        dims = int(os.environ.get("SANCTUM_LOCAL_EMBED_DIMS", "768"))
        device = os.environ.get("SANCTUM_LOCAL_EMBED_DEVICE", "cpu").strip().lower()
        dtype = os.environ.get("SANCTUM_LOCAL_EMBED_DTYPE", "float32").strip().lower()
        return ServiceConfig(
            port=port,
            token=token,
            revision=revision,
            dims=dims,
            device=device,
            dtype=dtype,
        )


def validate_bind_config(config: ServiceConfig) -> None:
    if config.host != "127.0.0.1":
        raise ValueError("INVALID_BIND")
    if config.port < 1 or config.port > 65535:
        raise ValueError("INVALID_BIND")


def validate_operational_config(config: ServiceConfig) -> str | None:
    """Return sanitized load error code, or None if config is loadable."""
    validate_bind_config(config)
    if config.dims not in ALLOWED_DIMS:
        return ERROR_LOAD_FAILED
    if config.device not in ("cpu", "cuda"):
        return ERROR_UNSUPPORTED_DTYPE
    dtype = config.dtype
    if dtype in ("fp16", "float16", "bf16"):
        return ERROR_UNSUPPORTED_DTYPE
    if dtype not in ("float32", "bfloat16"):
        return ERROR_UNSUPPORTED_DTYPE
    if config.device == "cpu" and dtype != "float32":
        return ERROR_UNSUPPORTED_DTYPE
    if config.device == "cuda" and dtype != "bfloat16":
        return ERROR_UNSUPPORTED_DTYPE
    try:
        validate_revision_string(config.revision)
    except ValueError:
        return ERROR_INVALID_REVISION
    return None


def configured_for_load(config: ServiceConfig) -> bool:
    return bool(config.token.strip())
