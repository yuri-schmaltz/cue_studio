"""Tests for the v2 plan endpoint's reference-image propagation.

The planner attaches the character's reference photos to the LLM prompt
and labels them per index. The endpoint builds the planner's keyword
arguments from the request body by copying a fixed list of keys — when
the reference paths and labels were missing from that list, a photo
stayed in the browser and never reached the model, and the LLM wrote
prompts for a character it had never seen.

These tests pin the list down: the reference keys must be forwarded,
and the character profiles the polish layer needs must be derived from
the speaker mappings when the request carries no explicit characters.
"""
from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services.director_pipeline import (  # noqa: E402
    _director_characters_from_speakers,
)


def _launch_planner_keys() -> tuple:
    """Read the planner-body key tuple out of launch.py without booting it."""
    source = (APP_ROOT / "launch.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if (
                    isinstance(target, ast.Name)
                    and target.id == "_V2_PLANNER_BODY_KEYS"
                ):
                    return ast.literal_eval(node.value)
    raise AssertionError("_V2_PLANNER_BODY_KEYS not found in launch.py")


class V2PlannerBodyKeyTests(unittest.TestCase):
    def setUp(self):
        self.keys = _launch_planner_keys()

    def test_forwards_the_character_reference_paths(self):
        self.assertIn("character_ref_paths", self.keys)

    def test_forwards_the_character_reference_labels(self):
        self.assertIn("character_ref_labels", self.keys)

    def test_forwards_the_location_references(self):
        self.assertIn("location_ref_paths", self.keys)
        self.assertIn("location_ref_labels", self.keys)

    def test_still_forwards_the_core_planning_inputs(self):
        for key in (
            "clips", "scene_description", "lyrics", "bpm",
            "reference_image_path", "speaker_mappings", "technical_prompt",
        ):
            self.assertIn(key, self.keys)


class PolishCharacterProfileTests(unittest.TestCase):
    """A music video has no `characters` list — the voices are the people."""

    def test_speaker_mappings_become_character_profiles(self):
        profiles = _director_characters_from_speakers([
            {"speakerId": "SPEAKER_00", "name": "gary", "role": "singing"},
        ])
        self.assertEqual(len(profiles), 1)
        self.assertEqual(profiles[0]["name"], "gary")

    def test_profile_carries_the_fields_polish_reads(self):
        profile = _director_characters_from_speakers([
            {"speakerId": "SPEAKER_00", "name": "gary", "role": "singing"},
        ])[0]
        # _make_char_map_from_global reads id + (display_name | name) and
        # (physical_description | description).
        self.assertTrue(profile.get("id"))
        self.assertTrue(profile.get("display_name") or profile.get("name"))
        self.assertTrue(
            profile.get("physical_description") or profile.get("description")
        )


if __name__ == "__main__":
    unittest.main()