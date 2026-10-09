"""ModelRuntime success path via mocks (no live weights)."""
from __future__ import annotations

import os
import sys
import types
import unittest
from unittest import mock

import numpy as np

from config import ServiceConfig
from runtime import ModelRuntime
from test_support import sample_revision


def _fake_torch() -> types.ModuleType:
    mod = types.ModuleType("torch")
    mod.__version__ = "2.0.0"
    mod.float32 = "float32"
    mod.bfloat16 = "bfloat16"
    cuda = types.SimpleNamespace(is_bf16_supported=lambda: True)
    mod.cuda = cuda
    return mod


class ModelRuntimeMockedLoadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cfg = ServiceConfig(
            token="t",
            revision=sample_revision(),
            dims=256,
            device="cpu",
            dtype="float32",
        )
        self.snap = os.path.join("snapshots", sample_revision())

    def test_loads_from_verified_snapshot_with_offline_kwargs(self) -> None:
        unit = np.ones(256, dtype=float) / np.sqrt(256.0)
        fake_model = mock.MagicMock()
        fake_model.max_seq_length = 8192
        fake_model.tokenizer.encode.return_value = [1, 2, 3]
        fake_model.encode.return_value = np.array([unit])

        st_ctor = mock.Mock(return_value=fake_model)
        st_mod = types.ModuleType("sentence_transformers")
        st_mod.SentenceTransformer = st_ctor
        st_mod.__version__ = "3.0.0"
        transformers_mod = types.ModuleType("transformers")
        transformers_mod.__version__ = "4.40.0"

        with mock.patch("runtime.snapshot_path_for_revision", return_value=self.snap):
            with mock.patch.dict(
                sys.modules,
                {
                    "sentence_transformers": st_mod,
                    "torch": _fake_torch(),
                    "transformers": transformers_mod,
                },
            ):
                runtime = ModelRuntime(self.cfg)
                identity = runtime.load()

        st_ctor.assert_called_once()
        _args, kwargs = st_ctor.call_args
        self.assertEqual(_args[0], self.snap)
        self.assertTrue(kwargs.get("local_files_only"))
        self.assertFalse(kwargs.get("trust_remote_code"))
        enc_kwargs = fake_model.encode.call_args.kwargs
        self.assertEqual(enc_kwargs.get("prompt"), "task: search result | query: ")
        self.assertEqual(enc_kwargs.get("truncate_dim"), 256)
        self.assertTrue(enc_kwargs.get("normalize_embeddings"))
        runtime.count_tokens("task: search result | query: hello")
        tok_kwargs = fake_model.tokenizer.encode.call_args.kwargs
        self.assertFalse(tok_kwargs.get("truncation", True))
        self.assertEqual(identity["descriptor"]["encoders"], ["text"])


if __name__ == "__main__":
    unittest.main()
