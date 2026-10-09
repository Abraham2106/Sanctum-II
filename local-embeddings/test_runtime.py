"""ModelRuntime success path via mocks (no numpy, no live weights)."""
from __future__ import annotations

import os
import sys
import types
import unittest
from unittest import mock

from config import ServiceConfig
from runtime import ModelRuntime
from test_support import sample_revision


class _FakeRow:
    def __init__(self, values: list[float]) -> None:
        self._values = values

    def tolist(self) -> list[float]:
        return self._values


def _fake_torch(cpu_only: bool = True) -> types.ModuleType:
    mod = types.ModuleType("torch")
    mod.__version__ = "2.0.0"
    mod.float32 = "float32"
    mod.bfloat16 = "bfloat16"
    mod.cuda = types.SimpleNamespace(is_bf16_supported=lambda: not cpu_only)
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

    def test_loads_snapshot_offline_encode_contract(self) -> None:
        unit = [1.0 / (256 ** 0.5)] * 256
        fake_model = mock.MagicMock()
        fake_model.max_seq_length = 8192
        fake_model.tokenizer.encode.return_value = [1] * 3
        fake_model.encode.return_value = [_FakeRow(unit)]

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
                    "torch": _fake_torch(cpu_only=True),
                    "transformers": transformers_mod,
                },
            ):
                runtime = ModelRuntime(self.cfg)
                identity = runtime.load()

        kwargs = st_ctor.call_args.kwargs
        self.assertTrue(kwargs.get("local_files_only"))
        self.assertFalse(kwargs.get("trust_remote_code"))
        self.assertEqual(kwargs["config_kwargs"]["vision_config"], None)
        self.assertEqual(kwargs["config_kwargs"]["audio_config"], None)
        calls = fake_model.encode.call_args_list
        self.assertTrue(all(c.kwargs.get("prompt") for c in calls))
        self.assertEqual(calls[0].args[0], ["sanctum readiness probe"])
        self.assertEqual(identity["descriptor"]["encoders"], ["text"])

    def test_cuda_without_bf16_support_rejected(self) -> None:
        cfg = ServiceConfig(
            token="t",
            revision=sample_revision(),
            dims=128,
            device="cuda",
            dtype="bfloat16",
        )
        st_mod = types.ModuleType("sentence_transformers")
        st_mod.SentenceTransformer = mock.Mock()
        st_mod.__version__ = "3.0.0"
        transformers_mod = types.ModuleType("transformers")
        transformers_mod.__version__ = "4.40.0"
        with mock.patch("runtime.snapshot_path_for_revision", return_value=self.snap):
            with mock.patch.dict(
                sys.modules,
                {
                    "sentence_transformers": st_mod,
                    "torch": _fake_torch(cpu_only=True),
                    "transformers": transformers_mod,
                },
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    ModelRuntime(cfg).load()
        self.assertEqual(str(ctx.exception), "UNSUPPORTED_DTYPE")


if __name__ == "__main__":
    unittest.main()
