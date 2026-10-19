"""ProjectSetup backend tests.

Covers the workspace-level setup helpers in `launch.py` and the
corresponding HTTP endpoints. ProjectSetup replaces the per-pipeline
"Director Setup" sidebar — these tests pin the contract so future
schema changes either update the tests deliberately or get caught at
CI time.

Run via:
    PYTHONPATH=. app/env/bin/python -m unittest tests.test_project_setup -v
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))


def _stub_save_path(tempdir: str) -> None:
    """Point wgp.server_config.save_path at `tempdir` for the duration
    of one test. The helpers in launch.py read `save_path` straight
    off wgp.server_config — no monkey-patching needed, just rewrite
    the key. We must import wgp via launch (which knows the right
    cwd-relative path) because importing wgp standalone triggers its
    top-level argparse.parse_args() that fails under pytest/unittest."""
    # `launch` is the canonical import path — it already imported wgp
    # at module load (during the test run) so reaching through the
    # module keeps us on the same wgp instance.
    import launch  # noqa: WPS433
    launch.wgp.server_config["save_path"] = tempdir
    launch.wgp.server_config.setdefault("services", {})["projects_root_path"] = tempdir


class ProjectSetupHelpersTests(unittest.TestCase):
    """Pure helpers round-trip and validation suite. Tests use a
    TemporaryDirectory for `save_path` so the real outputs folder is
    never touched."""

    def setUp(self) -> None:
        self._tempdir = tempfile.mkdtemp()
        _stub_save_path(self._tempdir)
        # Imported lazily — surfaces import errors against the test
        # name rather than the module name.
        from launch import (  # noqa: WPS433
            _DEFAULT_PROJECT_SETUP,
            _load_workspace_setup,
            _persist_workspace_setup,
            _workspace_setup_path,
        )
        self._load = _load_workspace_setup
        self._persist = _persist_workspace_setup
        self._path = _workspace_setup_path
        self._defaults = dict(_DEFAULT_PROJECT_SETUP)

    def tearDown(self) -> None:
        shutil.rmtree(self._tempdir, ignore_errors=True)

    def test_default_workspace_returns_none_path(self):
        self.assertIsNone(self._path("default"))

    def test_invalid_workspace_name_returns_none_path(self):
        self.assertIsNone(self._path("../etc/passwd"))
        self.assertIsNone(self._path(""))
        self.assertIsNone(self._path("name with space"))

    def test_valid_workspace_resolves_inside_outputs(self):
        path = self._path("demo")
        self.assertIsNotNone(path)
        assert path is not None  # type narrowing
        self.assertTrue(path.endswith(os.path.join("demo", "setup.json")))

    def test_loading_missing_workspace_returns_schema_defaults(self):
        result = self._load("demo")
        self.assertEqual(result["aspect_ratio"], "16:9")
        self.assertEqual(result["resolution"], "720p")
        self.assertFalse(result["seamless"])
        self.assertFalse(result["auto_mode"])
        self.assertEqual(result["schema_version"], 1)

    def test_persist_round_trip_keeps_every_field(self):
        payload = {
            "aspect_ratio": "21:9",
            "resolution": "1080p",
            "seamless": True,
            "auto_mode": True,
            "video_model": "ltx2_22B_distilled_1_1",
            "image_model": "flux2_klein_9b",
            "music_source": "generate",
            "music_model": "ace_step_v1_5",
            "default_image_loras": {"activated_loras": ["ip_adapter"]},
            "schema_version": 1,
        }
        persisted = self._persist("demo", payload)
        self.assertEqual(persisted["aspect_ratio"], "21:9")
        self.assertEqual(persisted["seamless"], True)
        self.assertEqual(persisted["music_model"], "ace_step_v1_5")
        loaded = self._load("demo")
        self.assertEqual(loaded["aspect_ratio"], "21:9")
        self.assertEqual(loaded["auto_mode"], True)

    def test_persist_rejects_malformed_payload(self):
        bad_payloads = [
            {"aspect_ratio": 42},
            {"resolution": True},
            {"seamless": "true"},
            {"auto_mode": 1},
            {"music_source": "guess"},
            {"schema_version": "1"},
            "not-a-dict",
            {"schema_version": 1.5},
            {"music_source": "UPLOAD"},  # case-sensitive
        ]
        for bad in bad_payloads:
            with self.subTest(payload=bad):
                with self.assertRaises(Exception) as ctx:
                    self._persist("demo", bad)
                self.assertEqual(getattr(ctx.exception, "status_code", None), 400)

    def test_persist_normalises_null_string_fields_to_empty(self):
        # JSON null for the model-style fields gets normalised to ""
        # so the UI can clear a model picker by sending null without
        # having to compute the empty-string sentinel itself. The
        # empty value means "use last selected" in applyWorkspaceSetup.
        persisted = self._persist("demo", {"video_model": None, "image_model": None, "aspect_ratio": None})
        self.assertEqual(persisted["video_model"], "")
        self.assertEqual(persisted["image_model"], "")
        # Resolution normalised too — sits on the same branch.
        self.assertEqual(persisted["aspect_ratio"], "")
        loaded = self._load("demo")
        self.assertEqual(loaded["video_model"], "")

    def test_persist_strips_unknown_keys(self):
        self._persist("demo", {"resolution": "1080p", "unknown_future_key": True})
        loaded = self._load("demo")
        self.assertEqual(loaded["resolution"], "1080p")
        self.assertNotIn("unknown_future_key", loaded)

    def test_partial_persist_uses_defaults_for_missing_keys(self):
        self._persist("demo", {"resolution": "1080p", "video_model": "ltx2"})
        loaded = self._load("demo")
        self.assertEqual(loaded["resolution"], "1080p")
        self.assertEqual(loaded["video_model"], "ltx2")
        # Defaults the user didn't override stay.
        self.assertEqual(loaded["aspect_ratio"], "16:9")
        self.assertFalse(loaded["auto_mode"])

    def test_persist_overwrites_atomically(self):
        self._persist("demo", {"resolution": "480p", "video_model": "x"})
        self._persist("demo", {"resolution": "1080p"})
        loaded = self._load("demo")
        self.assertEqual(loaded["resolution"], "1080p")

    def test_persist_default_workspace_rejected(self):
        with self.assertRaises(Exception) as ctx:
            self._persist("default", {"resolution": "1080p"})
        self.assertEqual(getattr(ctx.exception, "status_code", None), 400)


class ProjectSetupSchemaVersionTests(unittest.TestCase):
    """Schema version is the escape hatch for future migrations. The
    reader must accept older versions without losing known fields,
    and must not crash on a future version whose shape we don't
    recognise yet."""

    def setUp(self) -> None:
        self._tempdir = tempfile.mkdtemp()
        _stub_save_path(self._tempdir)
        future_ws = os.path.join(self._tempdir, "future")
        os.makedirs(future_ws)
        # A setup.json with a future schema_version + an unknown field.
        with open(os.path.join(future_ws, "setup.json"), "w") as handle:
            json.dump({"resolution": "540p", "schema_version": 9999, "future_key": "x"}, handle)

    def tearDown(self) -> None:
        shutil.rmtree(self._tempdir, ignore_errors=True)

    def test_unknown_schema_version_returns_known_fields_safely(self):
        from launch import _load_workspace_setup  # type: ignore  # noqa: WPS433
        loaded = _load_workspace_setup("future")
        # Known field came through; unknown key was ignored.
        self.assertEqual(loaded["resolution"], "540p")
        self.assertNotIn("future_key", loaded)


class ProjectSetupPathSafetyTests(unittest.TestCase):
    """Confirm the helpers cannot escape the configured outputs
    directory — the same guarantee the HTTP surface inherits because
    they both run through `_workspace_setup_path`."""

    def setUp(self) -> None:
        self._tempdir = tempfile.mkdtemp()
        _stub_save_path(self._tempdir)
        from launch import _workspace_setup_path  # noqa: WPS433
        self._path = _workspace_setup_path

    def tearDown(self) -> None:
        shutil.rmtree(self._tempdir, ignore_errors=True)

    def test_traversal_attempts_rejected(self):
        for bad in ("..", "../etc", "subdir/../../escape", ""):
            self.assertIsNone(self._path(bad), f"Path traversal not blocked for {bad!r}")


if __name__ == "__main__":
    unittest.main()
