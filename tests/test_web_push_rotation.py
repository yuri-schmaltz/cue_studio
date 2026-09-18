"""Tests for the VAPID key rotation state machine."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from services import web_push_rotation  # noqa: E402


class FakeClock:
    def __init__(self, start: float = 1_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _fake_keygen(seq: list[int]) -> Any:
    seq.append(1)
    idx = len(seq)
    return (f"-----BEGIN PRIVATE KEY {idx}-----\n", f"public-{idx}")


class RotationStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.path = Path(self.tmpdir.name) / "web_push.json"
        self.clock = FakeClock()
        self.seq: list[int] = []
        self.factory = lambda: _fake_keygen(self.seq)
        self.rot = web_push_rotation.WebPushKeyRotation(
            self.path,
            rotation_interval_seconds=10,
            overlap_seconds=5,
            clock=self.clock,
        )

    def test_initial_generation_creates_one_key(self) -> None:
        state = self.rot.load_or_initialise(self.factory)
        self.assertEqual(len(self.seq), 1)
        self.assertEqual(state.active.label, "initial")
        self.assertIsNone(state.previous)
        self.assertIsNone(state.overlap_until)

    def test_second_load_within_interval_does_not_rotate(self) -> None:
        self.rot.load_or_initialise(self.factory)
        state = self.rot.load_or_initialise(self.factory)
        self.assertEqual(len(self.seq), 1, "should not have generated a new key")
        self.assertEqual(state.active.label, "initial")

    def test_rotation_after_interval(self) -> None:
        self.rot.load_or_initialise(self.factory)
        self.clock.advance(11)  # beyond the 10-second interval
        state = self.rot.load_or_initialise(self.factory)
        self.assertEqual(len(self.seq), 2)
        self.assertNotEqual(state.active.label, "initial")
        self.assertIsNotNone(state.previous)
        self.assertIsNotNone(state.overlap_until)

    def test_overlap_expires_and_previous_purged(self) -> None:
        self.rot.load_or_initialise(self.factory)
        self.clock.advance(11)
        state = self.rot.load_or_initialise(self.factory)
        self.assertIsNotNone(state.previous)
        # Move past the overlap window.
        self.clock.advance(6)
        state = self.rot.load_or_initialise(self.factory)
        self.assertIsNone(state.previous)
        self.assertIsNone(state.overlap_until)

    def test_force_rotate_keeps_previous(self) -> None:
        self.rot.load_or_initialise(self.factory)
        state = self.rot.force_rotate(self.factory)
        self.assertEqual(len(self.seq), 2)
        self.assertIsNotNone(state.previous)
        self.assertEqual(state.previous.label, "initial")

    def test_revoke_previous_clears_overlap(self) -> None:
        self.rot.load_or_initialise(self.factory)
        self.clock.advance(11)
        self.rot.load_or_initialise(self.factory)
        self.assertIsNotNone(self.rot.load_or_initialise(lambda: ("", "")).previous)
        state = self.rot.revoke_previous()
        self.assertIsNone(state.previous)
        self.assertIsNone(state.overlap_until)

    def test_legacy_v1_migrates_without_rekeying(self) -> None:
        legacy = {
            "version": 1,
            "vapid_private_key": "-----BEGIN LEGACY KEY-----\n",
            "vapid_public_key": "legacy-public",
            "subscriptions": [],
        }
        self.path.write_text(json.dumps(legacy))
        state = self.rot.load_or_initialise(self.factory)
        self.assertEqual(len(self.seq), 0, "no new key on migration")
        self.assertEqual(state.active.label, "legacy-migrated")
        self.assertEqual(state.active.private_pem, "-----BEGIN LEGACY KEY-----\n")

    def test_history_capped_at_five(self) -> None:
        # Force many rotations and confirm history stays bounded.
        for i in range(8):
            self.clock.advance(11)
            self.rot.load_or_initialise(self.factory)
        state = self.rot.load_or_initialise(self.factory)
        self.assertLessEqual(len(state.history), 5)

    def test_corrupt_state_file_regenerates(self) -> None:
        self.path.write_text("{not json")
        state = self.rot.load_or_initialise(self.factory)
        self.assertEqual(len(self.seq), 1)
        self.assertEqual(state.active.label, "initial")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
