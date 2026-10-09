"""Unit tests for config and loader errors."""
from __future__ import annotations

import os
import unittest
from unittest import mock

from config import ERROR_INVALID_REVISION, ERROR_UNSUPPORTED_DTYPE, ServiceConfig
from model import LoadState, embed_request, reset_service_state_for_tests, start_background_load
from runtime import ModelRuntime
from test_support import FakeRuntime, sample_revision, sample_runtime


class LoaderErrorTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_service_state_for_tests()

    def tearDown(self) -> None:
        reset_service_state_for_tests()

    def test_uppercase_revision_rejected(self) -> None:
        rev = "A" + sample_revision()[1:]
        cfg = ServiceConfig(token="t", revision=rev, dims=768)
        with self.assertRaises(RuntimeError) as ctx:
            ModelRuntime(cfg).load()
        self.assertEqual(str(ctx.exception), ERROR_INVALID_REVISION)

    def test_cpu_bfloat16_rejected(self) -> None:
        cfg = ServiceConfig(
            token="t",
            revision=sample_revision(),
            dims=768,
            device="cpu",
            dtype="bfloat16",
        )
        with self.assertRaises(RuntimeError) as ctx:
            ModelRuntime(cfg).load()
        self.assertEqual(str(ctx.exception), ERROR_UNSUPPORTED_DTYPE)

    def test_background_load_sanitizes_unknown_errors(self) -> None:
        os.environ["SANCTUM_LOCAL_EMBED_TOKEN"] = "tok"
        os.environ["SANCTUM_LOCAL_EMBED_REVISION"] = sample_revision()
        cfg = ServiceConfig.from_env()
        with mock.patch.object(ModelRuntime, "load", side_effect=RuntimeError("secret path leak")):
            start_background_load(cfg)
            thread = __import__("model")._load_thread
            assert thread is not None
            thread.join(timeout=2)
        self.assertEqual(__import__("model").get_failure_code(), "LOAD_FAILED")


class EmbedRequestTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_service_state_for_tests()
        self.cfg = ServiceConfig(
            token="tok",
            revision=sample_revision(),
            dims=768,
            port=18767,
        )

    def tearDown(self) -> None:
        reset_service_state_for_tests()

    def test_fake_runtime_round_trip(self) -> None:
        start_background_load(self.cfg, runtime_factory=FakeRuntime)
        thread = __import__("model")._load_thread
        assert thread is not None
        thread.join(timeout=2)
        identity = __import__("model").get_identity()
        assert identity is not None
        vecs = embed_request(self.cfg, "query", ["alpha", "beta"], identity)
        self.assertEqual(len(vecs), 2)


if __name__ == "__main__":
    unittest.main()
