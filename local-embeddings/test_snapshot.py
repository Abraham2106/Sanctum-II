"""Snapshot resolution with synthetic cache directories."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from snapshot import snapshot_path_for_revision
from test_support import sample_revision


class SnapshotTests(unittest.TestCase):
    def test_missing_snapshot_raises(self) -> None:
        with tempfile.TemporaryDirectory() as cache:
            with mock.patch("snapshot.hf_hub_cache_dir", return_value=cache):
                with self.assertRaises(OSError):
                    snapshot_path_for_revision(sample_revision())

    def test_wrong_revision_basename_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as cache:
            rev = sample_revision()
            rel = os.path.join("models--google--embeddinggemma-2", "snapshots", rev)
            snap = os.path.join(cache, rel)
            os.makedirs(snap)
            with open(os.path.join(snap, "config.json"), "w", encoding="utf-8") as fh:
                fh.write("{}")
            with mock.patch("snapshot.hf_hub_cache_dir", return_value=cache):
                path = snapshot_path_for_revision(rev)
                self.assertTrue(path.endswith(rev))


if __name__ == "__main__":
    unittest.main()
