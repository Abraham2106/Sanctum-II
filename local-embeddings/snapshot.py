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


def snapshot_path_for_revision(revision: str) -> str:
    cache_name = "models--" + MODEL_ID.replace("/", "--")
    snap = os.path.join(hf_hub_cache_dir(), cache_name, "snapshots", revision)
    if not os.path.isdir(snap):
        raise OSError(ERROR_MODEL_NOT_INSTALLED)
    basename = os.path.basename(os.path.normpath(snap))
    if basename != revision:
        raise OSError(ERROR_MODEL_NOT_INSTALLED)
    return snap
