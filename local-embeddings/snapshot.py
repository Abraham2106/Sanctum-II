"""Resolve immutable Hugging Face cache snapshots (local only)."""
from __future__ import annotations

import os

from identity import MODEL_ID

ERROR_MODEL_NOT_INSTALLED = "MODEL_NOT_INSTALLED"


def hf_hub_cache_dir() -> str:
    if env := os.environ.get("HF_HUB_CACHE"):
        return env
    if hf_home := os.environ.get("HF_HOME"):
        return os.path.join(hf_home, "hub")
    return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def _cache_namespace() -> str:
    return "models--" + MODEL_ID.replace("/", "--")


def _expected_snapshot_rel(revision: str) -> str:
    return os.path.join(_cache_namespace(), "snapshots", revision)


def _has_required_cache_metadata(snap_dir: str) -> bool:
    config_path = os.path.join(snap_dir, "config.json")
    modules_path = os.path.join(snap_dir, "modules.json")
    tokenizer_path = os.path.join(snap_dir, "tokenizer_config.json")
    return os.path.isfile(config_path) or os.path.isfile(modules_path) or os.path.isfile(tokenizer_path)


def snapshot_path_for_revision(revision: str) -> str:
    cache_root = hf_hub_cache_dir()
    rel = _expected_snapshot_rel(revision)
    snap = os.path.join(cache_root, rel)
    if not os.path.isdir(snap):
        raise OSError(ERROR_MODEL_NOT_INSTALLED)
    expected_real = os.path.realpath(snap)
    if os.path.basename(expected_real) != revision:
        raise OSError(ERROR_MODEL_NOT_INSTALLED)
    parent_ns = os.path.basename(os.path.dirname(os.path.dirname(expected_real)))
    if parent_ns != _cache_namespace():
        raise OSError(ERROR_MODEL_NOT_INSTALLED)
    if not _has_required_cache_metadata(expected_real):
        raise OSError(ERROR_MODEL_NOT_INSTALLED)
    return expected_real
