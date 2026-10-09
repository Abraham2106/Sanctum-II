"""Identity matching and vector validation tests."""
from __future__ import annotations

import unittest

from identity import build_identity, identities_match
from test_support import sample_revision, sample_runtime
from vectors import coerce_embedding_rows


class IdentityMatchTests(unittest.TestCase):
    def test_rejects_extra_outer_keys(self) -> None:
        identity = build_identity(sample_revision(), 768, "cpu", "float32", sample_runtime())
        mutated = dict(identity)
        mutated["extra"] = 1
        self.assertFalse(identities_match(identity, mutated))

    def test_rejects_fingerprint_tamper(self) -> None:
        identity = build_identity(sample_revision(), 768, "cpu", "float32", sample_runtime())
        tampered = dict(identity)
        tampered["configFingerprint"] = "0" * 64
        self.assertFalse(identities_match(identity, tampered))


class VectorValidationTests(unittest.TestCase):
    def test_rejects_overflow_components(self) -> None:
        row = [1e308] * 128
        with self.assertRaises(ValueError):
            coerce_embedding_rows([row], 1, 128)

    def test_renorm_non_unit_vectors(self) -> None:
        row = [2.0, 0.0, 0.0, 0.0]
        out = coerce_embedding_rows([row], 1, 4)
        norm = sum(x * x for x in out[0])
        self.assertAlmostEqual(norm, 1.0, places=6)

    def test_rejects_boolean(self) -> None:
        with self.assertRaises(ValueError):
            coerce_embedding_rows([[True, 0.0]], 1, 2)


if __name__ == "__main__":
    unittest.main()
