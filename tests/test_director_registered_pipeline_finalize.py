"""Tests for closing a register-only Director pipeline.

The v2 plan endpoint registers a pipeline so a browser refresh can
reattach to the planning run, but it starts no worker — nothing else
moves the pipeline past ``running``. The frontend treats an active
pipeline as "do not save the workspace draft", so the planned clip
prompts never reached disk: a finished plan was lost on every reload.

These tests pin down that the registered pipeline is closed once the
plan returns, and that terminal pipelines are left untouched.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services import director_pipeline  # noqa: E402


class RegisteredPipelineFinalizeTests(unittest.TestCase):
    def setUp(self):
        self._pipelines = director_pipeline._pipelines
        self._saved = director_pipeline._save_pipeline_state
        # The state writer touches disk; the behavior under test is the
        # in-memory transition.
        director_pipeline._save_pipeline_state = lambda pid: True
        self._pipelines.clear()

    def tearDown(self):
        director_pipeline._save_pipeline_state = self._saved
        self._pipelines.clear()

    def _register(self, pid: str = "pipe-test", **fields) -> str:
        self._pipelines[pid] = {
            "pipeline_id": pid,
            "status": "running",
            "phase": "planning",
            "progress": {"current": 0, "total": 0, "message": "Starting..."},
            **fields,
        }
        return pid

    def test_marks_a_running_registered_pipeline_completed(self):
        pid = self._register()
        self.assertTrue(director_pipeline.finalize_registered_pipeline(pid))
        self.assertEqual(self._pipelines[pid]["status"], "completed")
        self.assertEqual(self._pipelines[pid]["phase"], "completed")
        self.assertEqual(self._pipelines[pid]["progress"]["message"], "Planning complete")

    def test_leaves_a_terminal_pipeline_untouched(self):
        for status in ("completed", "failed", "cancelled", "crashed"):
            with self.subTest(status=status):
                self._pipelines.clear()
                pid = self._register(status=status, phase=status)
                self.assertFalse(director_pipeline.finalize_registered_pipeline(pid))
                self.assertEqual(self._pipelines[pid]["status"], status)

    def test_ignores_an_unknown_pipeline(self):
        self.assertFalse(director_pipeline.finalize_registered_pipeline("missing"))

    def test_does_not_overwrite_a_cancelled_pipeline(self):
        pid = self._register()
        self._pipelines[pid]["status"] = "cancelled"
        self.assertFalse(director_pipeline.finalize_registered_pipeline(pid))
        self.assertEqual(self._pipelines[pid]["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()