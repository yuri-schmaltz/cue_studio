"""Tests for the character profiles derived from speaker mappings.

A music video has no explicit ``characters`` list: its people are the
identified voices, each with a name and a vocal role. The planner turns
those mappings into character profiles, and the prompt-polish layer
must see the same list — otherwise it runs with an empty name map and
can replace the performer's name with a generic "the man" or drop it as
a hallucinated proper noun.
"""
from __future__ import annotations

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


class SpeakerCharactersTests(unittest.TestCase):
    def test_builds_a_profile_per_named_speaker(self):
        profiles = _director_characters_from_speakers([
            {"speakerId": "SPEAKER_00", "name": "gary", "role": "singing"},
        ])
        self.assertEqual(len(profiles), 1)
        self.assertEqual(profiles[0]["id"], "SPEAKER_00")
        self.assertEqual(profiles[0]["name"], "gary")
        self.assertEqual(profiles[0]["display_name"], "gary")
        self.assertEqual(profiles[0]["physical_description"], "the gary")
        self.assertEqual(profiles[0]["voice_description"], "singing")

    def test_accepts_the_mapping_shape(self):
        profiles = _director_characters_from_speakers({
            "SPEAKER_00": {"name": "gary", "role": "singing"},
        })
        self.assertEqual(len(profiles), 1)
        self.assertEqual(profiles[0]["name"], "gary")

    def test_skips_speakers_without_a_name(self):
        profiles = _director_characters_from_speakers([
            {"speakerId": "SPEAKER_00", "name": "", "role": "singing"},
            {"speakerId": "SPEAKER_01", "name": "lumi", "role": "speaking"},
        ])
        self.assertEqual(len(profiles), 1)
        self.assertEqual(profiles[0]["name"], "lumi")

    def test_skips_duplicate_names(self):
        profiles = _director_characters_from_speakers([
            {"speakerId": "SPEAKER_00", "name": "gary", "role": "singing"},
            {"speakerId": "SPEAKER_01", "name": "Gary", "role": "speaking"},
        ])
        self.assertEqual(len(profiles), 1)

    def test_empty_input_yields_no_profiles(self):
        self.assertEqual(_director_characters_from_speakers([]), [])
        self.assertEqual(_director_characters_from_speakers(None), [])
        self.assertEqual(_director_characters_from_speakers({}), [])

    def test_ignores_malformed_entries(self):
        profiles = _director_characters_from_speakers([
            "not a mapping",
            {"speakerId": "SPEAKER_00", "name": "gary", "role": "singing"},
        ])
        self.assertEqual(len(profiles), 1)
        self.assertEqual(profiles[0]["name"], "gary")


if __name__ == "__main__":
    unittest.main()
