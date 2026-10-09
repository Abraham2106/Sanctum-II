"""Unit tests for identity, config, vectors, and loader errors."""
from __future__ import annotations

import os
import unittest
from unittest import mock

from config import ERROR_INVALID_REVISION, ERROR_UNSUPPORTED_DTYPE, ServiceConfig
from identity import (
    build_identity,
    canonical_json_bytes,
    config_fingerprint,
    identities_match,
    utf16_code_unit_len,
)
from model import (
    ERROR_DEPENDENCY_MISSING,
    LoadState,
    embed_request,
    reset_service_state_for_tests,
    start_background_load,
)
from runtime import ModelRuntime
from test_support import FakeRuntime, sample_revision
from vectors import coerce_embedding_rows


def sample_runtime() -> dict[str, str]:
    return {
        "python": "3.12.0",
        "torch": "2.0.0",
        "transformers": "4.40.0",
        "sentence_transformers": "3.0.0",
    }


class IdentityTests(unittest.TestCase):
    def test_descriptor_exact_schema_and_fingerprint(self) -> None:
        identity = build_identity(sample_revision(), 768, "cpu", "float32", sample_runtime())
        desc = identity["descriptor"]
        self.assertEqual(desc["backend"], "sentence-transformers")
        self.assertEqual(desc["queryPrefix"], "task: search result | query: ")
        self.assertEqual(identity["configFingerprint"], config_fingerprint(desc))
        self.assertIn(b'"sentence_transformers"', canonical_json_bytes(desc["runtime"]))

    def test_identity_match_strict_types(self) -> None:
        a = build_identity(sample_revision(), 768, "cpu", "float32", sample_runtime())
        b = dict(a)
        self.assertTrue(identities_match(a, b))
        b["dims"] = 512
        self.assertFalse(identities_match(a, b))


class Utf16Tests(unittest.TestCase):
    def test_counts_astral_as_two_units(self) -> None:
        self.assertEqual(utf16_code_unit_len("a"), 1)
        self.assertEqual(utf16_code_unit_len("a" * 3001), 3001)

    def test_rejects_lone_surrogate(self) -> None:
        with self.assertRaises(ValueError):
            utf16_code_unit_len("\ud800")


class VectorTests(unittest.TestCase):
    def test_rejects_boolean_before_float(self) -> None:
        with self.assertRaises(ValueError):
            coerce_embedding_rows([[True, 0.0]], 1, 2)


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

    def test_missing_dependency_surfaces_code(self) -> None:
        cfg = ServiceConfig(token="t", revision=sample_revision(), dims=768)
        with mock.patch.dict("sys.modules", {"sentence_transformers": None}):
            with self.assertRaises(RuntimeError) as ctx:
                ModelRuntime(cfg).load()
        self.assertEqual(str(ctx.exception), ERROR_DEPENDENCY_MISSING)

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
        self.assertEqual(len(vecs[0]), 768)


if __name__ == "__main__":
    unittest.main()
