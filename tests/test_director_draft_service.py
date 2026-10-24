"""Tests for the standalone director draft persistence service."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.services.director_draft import (
    DirectorDraftError,
    delete_draft,
    draft_path,
    load_draft,
    save_draft,
)


class DirectorDraftServiceTests(unittest.TestCase):
    def test_draft_path_resolution(self):
        with tempfile.TemporaryDirectory() as root:
            default_p = draft_path(root, "default")
            self.assertEqual(default_p, str(Path(root).resolve() / "director_draft.json"))

            named_p = draft_path(root, "my_project")
            self.assertEqual(named_p, str(Path(root).resolve() / "my_project" / "director_draft.json"))

            # Path traversal rejection
            self.assertIsNone(draft_path(root, "../outside"))
            self.assertIsNone(draft_path(root, "bad/name"))
            self.assertIsNone(draft_path(root, ""))

    def test_save_and_load_round_trip(self):
        with tempfile.TemporaryDirectory() as root:
            draft_payload = {
                "directorAudioPath": "uploads/audio/c7cd2053.wav",
                "directorAudioName": "Chanson de Paris.wav",
                "directorStep": "scenes",
                "directorSceneDescription": "Cinematic Paris street in autumn",
                "directorPlannedClips": [{"start": 0, "end": 5, "label": "intro"}],
                "directorClipPlans": [{"image_prompt": "Paris cafe", "video_prompt": "Camera pans"}],
            }
            saved = save_draft(root, "paris_project", draft_payload)
            self.assertEqual(saved, draft_payload)

            loaded = load_draft(root, "paris_project")
            self.assertEqual(loaded, draft_payload)

    def test_missing_and_corrupt_files_return_none(self):
        with tempfile.TemporaryDirectory() as root:
            # Missing
            self.assertIsNone(load_draft(root, "non_existent"))

            # Corrupt JSON
            p = Path(root) / "corrupt_proj" / "director_draft.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("{invalid json", encoding="utf-8")
            self.assertIsNone(load_draft(root, "corrupt_proj"))

            # Non-dict JSON (e.g. array)
            p.write_text("[1, 2, 3]", encoding="utf-8")
            self.assertIsNone(load_draft(root, "corrupt_proj"))

    def test_delete_draft(self):
        with tempfile.TemporaryDirectory() as root:
            payload = {"step": "review"}
            save_draft(root, "test_proj", payload)
            self.assertIsNotNone(load_draft(root, "test_proj"))

            self.assertTrue(delete_draft(root, "test_proj"))
            self.assertIsNone(load_draft(root, "test_proj"))
            self.assertFalse(delete_draft(root, "test_proj"))

    def test_invalid_payload_raises_error(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(DirectorDraftError):
                save_draft(root, "test_proj", "not a dict")  # type: ignore

    def test_draft_snapshots_round_trip(self):
        with tempfile.TemporaryDirectory() as root:
            payload = {
                "directorStep": "scenes",
                "directorPlannedClips": [{"start": 0, "end": 4}],
                "snapshots": [
                    {
                        "timestamp": 1234567890,
                        "label": "Storyboard 1",
                        "plannedClips": [{"start": 0, "end": 2}],
                    }
                ],
            }
            save_draft(root, "snap_proj", payload)
            loaded = load_draft(root, "snap_proj")
            self.assertEqual(loaded, payload)
            self.assertEqual(len(loaded["snapshots"]), 1)

    def test_unicode_and_special_characters(self):
        with tempfile.TemporaryDirectory() as root:
            payload = {
                "directorSceneDescription": "Café de l'amour 🥐☕ à Paris \n\t «Cinéma d'auteur» 🎬✨",
                "prompts": ["中文提示词 🐉", "日本語プロンプト 🌸", "العربية 🌙", "Сценарий ❄️"],
            }
            save_draft(root, "unicode_proj", payload)
            loaded = load_draft(root, "unicode_proj")
            self.assertEqual(loaded, payload)

    def test_empty_file_returns_none(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root) / "empty_proj" / "director_draft.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("", encoding="utf-8")
            self.assertIsNone(load_draft(root, "empty_proj"))

    def test_payload_exceeding_max_bytes_raises_413(self):
        from app.services.director_draft import MAX_DRAFT_BYTES
        with tempfile.TemporaryDirectory() as root:
            huge_payload = {"giant_field": "X" * (MAX_DRAFT_BYTES + 1024)}
            with self.assertRaises(DirectorDraftError) as ctx:
                save_draft(root, "huge_proj", huge_payload)
            self.assertEqual(ctx.exception.status_code, 413)

    def test_repeated_rapid_saves_leave_no_tmp_artifacts(self):
        with tempfile.TemporaryDirectory() as root:
            for i in range(25):
                save_draft(root, "stress_proj", {"iteration": i, "data": [i] * 100})
            loaded = load_draft(root, "stress_proj")
            self.assertEqual(loaded["iteration"], 24)
            proj_dir = Path(root) / "stress_proj"
            files = list(proj_dir.iterdir())
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0].name, "director_draft.json")


