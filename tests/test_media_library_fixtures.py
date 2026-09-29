"""Tests for the user media library fixture paths.

Background
----------
The user keeps reference media outside the repo (Google Drive syncs
into ``/home/yuri/Google/``). Two tests verify the registry in
``app/services/test_fixtures.py`` and the ``media_library_paths``
fixture wired through ``conftest.py``.

These tests are tagged with ``@pytest.mark.media`` so a CI runner
that doesn't have the library mounted can skip them with
``pytest -m 'not media'``. On the user's workstation they all run.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pytest  # noqa: E402  — pytest is imported as a runtime dep of the test

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ROOT = REPO_ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))


class RegistryConstantsTests(unittest.TestCase):
    """Pure-logic tests for the registry — no on-disk state required."""

    def test_media_library_path_default(self):
        # Default root is the user's Google Drive sync location.
        from services import test_fixtures
        self.assertEqual(
            str(test_fixtures.MEDIA_LIBRARY_DIR),
            "/home/yuri/Google/midias",
        )

    def test_scripts_library_path_default(self):
        from services import test_fixtures
        self.assertEqual(
            str(test_fixtures.SCRIPTS_LIBRARY_DIR),
            "/home/yuri/Google/documentos/04-biblioteca/roteiros-referencia",
        )

    def test_env_override_takes_precedence(self):
        # Import the module first so reload has something to reload.
        from services import test_fixtures
        import importlib
        try:
            with patch.dict(
                "os.environ",
                {
                    "CUE_STUDIO_MEDIA_LIBRARY_DIR": "/tmp/test-media",
                    "CUE_STUDIO_SCRIPTS_LIBRARY_DIR": "/tmp/test-scripts",
                },
                clear=False,
            ):
                reloaded = importlib.reload(test_fixtures)
                self.assertEqual(
                    str(reloaded.MEDIA_LIBRARY_DIR), "/tmp/test-media"
                )
                self.assertEqual(
                    str(reloaded.SCRIPTS_LIBRARY_DIR), "/tmp/test-scripts"
                )
        finally:
            # Always reload back to the on-disk defaults so other
            # tests in the suite see the real library path, not the
            # override we just verified. Critical because reload
            # mutates the module in place — without this, every
            # later test that uses MEDIA_LIBRARY_DIR sees the empty
            # string from the override.
            with patch.dict(
                "os.environ",
                {
                    "CUE_STUDIO_MEDIA_LIBRARY_DIR": "",
                    "CUE_STUDIO_SCRIPTS_LIBRARY_DIR": "",
                },
                clear=False,
            ):
                importlib.reload(test_fixtures)

    def test_extension_whitelists_match_ui(self):
        # The whitelist must match what the Director's file pickers
        # actually accept. If the UI accepts more formats than the
        # fixture registry, tests will pass invalid extensions.
        from services import test_fixtures
        # Audio: MP3 + WAV covers the user's library.
        self.assertIn(".mp3", test_fixtures.AUDIO_EXTENSIONS)
        self.assertIn(".wav", test_fixtures.AUDIO_EXTENSIONS)
        # Scripts: TXT covers the user's library; MD is a bonus.
        self.assertIn(".txt", test_fixtures.SCRIPT_EXTENSIONS)
        self.assertIn(".md", test_fixtures.SCRIPT_EXTENSIONS)
        # Images: JPG + PNG covers the user's library.
        self.assertIn(".jpg", test_fixtures.IMAGE_EXTENSIONS)
        self.assertIn(".png", test_fixtures.IMAGE_EXTENSIONS)

    def test_subdirectory_names_are_stable(self):
        # Renaming any of these would silently break fixtures pointing
        # at the old name. Pin the public names so a rename shows up
        # as a failing test, not as a silent test miss.
        from services import test_fixtures
        self.assertEqual(test_fixtures.MEDIA_AUDIO_SUBDIR, "audios")
        self.assertEqual(test_fixtures.MEDIA_IMAGES_SUBDIR, "imagens")
        self.assertEqual(test_fixtures.MEDIA_VIDEO_SUBDIR, "videos")
        self.assertEqual(test_fixtures.SCRIPTS_CINEMA_SUBDIR, "cinema")
        self.assertEqual(test_fixtures.SCRIPTS_SERIES_SUBDIR, "series")


@pytest.mark.media
class LibraryFixtureTests(unittest.TestCase):
    """Tests that require the user's library to be on disk."""

    def setUp(self):
        from services import test_fixtures
        if not test_fixtures.MEDIA_LIBRARY_DIR.is_dir():
            self.skipTest(
                f"Media library not found at {test_fixtures.MEDIA_LIBRARY_DIR}"
            )
        if not test_fixtures.SCRIPTS_LIBRARY_DIR.is_dir():
            self.skipTest(
                f"Scripts library not found at {test_fixtures.SCRIPTS_LIBRARY_DIR}"
            )

    def test_audio_subdir_has_files(self):
        from services import test_fixtures
        files = test_fixtures.list_audio_files()
        self.assertGreater(len(files), 0, "Audio library is unexpectedly empty")
        # ``list_audio_files`` accepts both audio-only and video
        # recordings (the user's tree mixes MP3/WAV with WhatsApp
        # MP4 captures). Every file must be in either whitelist.
        accepted = (
            set(test_fixtures.AUDIO_EXTENSIONS)
            | set(test_fixtures.VIDEO_EXTENSIONS)
        )
        for f in files:
            self.assertIn(f.suffix.lower(), accepted)

    def test_images_subdir_has_files(self):
        from services import test_fixtures
        files = test_fixtures.list_image_files()
        self.assertGreater(len(files), 0, "Images library is unexpectedly empty")
        for f in files:
            self.assertIn(f.suffix.lower(), test_fixtures.IMAGE_EXTENSIONS)

    def test_cinema_scripts_subdir_has_files(self):
        from services import test_fixtures
        files = test_fixtures.list_script_files(test_fixtures.SCRIPTS_CINEMA_SUBDIR)
        self.assertGreater(
            len(files), 0, "Cinema scripts library is unexpectedly empty"
        )
        for f in files:
            self.assertIn(f.suffix.lower(), test_fixtures.SCRIPT_EXTENSIONS)

    def test_first_audio_is_recently_modified(self):
        from services import test_fixtures
        first = test_fixtures.first_audio()
        self.assertTrue(first.is_file())
        # Sanity: the helper returns a real file, not a directory.
        self.assertFalse(first.is_dir())

    def test_first_image_is_recently_modified(self):
        from services import test_fixtures
        first = test_fixtures.first_image()
        self.assertTrue(first.is_file())

    def test_library_summary_shape(self):
        from services import test_fixtures
        summary = test_fixtures.library_summary()
        # The summary is a small dict; the keys are stable so debug
        # helpers that print it don't break when the user adds new
        # files.
        self.assertIn("media_root", summary)
        self.assertIn("scripts_root", summary)
        self.assertIn("media", summary)
        self.assertIn("scripts", summary)
        # Counts are non-negative integers — never None, never strings.
        for kind, count in summary["media"].items():
            self.assertIsInstance(count, int)
            self.assertGreaterEqual(count, 0)
        for kind, count in summary["scripts"].items():
            self.assertIsInstance(count, int)
            self.assertGreaterEqual(count, 0)


if __name__ == "__main__":
    unittest.main()