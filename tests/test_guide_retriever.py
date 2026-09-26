"""Unit tests for the Dynamic Guide Retriever and Few-Shot selector."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ROOT = REPO_ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services.director.guide_retriever import (
    extract_core_rules,
    get_genre_few_shots,
    retrieve_focused_prompt_guide,
)


class GuideRetrieverTests(unittest.TestCase):
    """Validate dynamic prompt guide extraction and few-shot formatting."""

    def test_extract_core_rules_short(self):
        text = "- Rule 1: Always specify lighting.\n- Rule 2: Keep pacing natural."
        extracted = extract_core_rules(text, max_chars=1000)
        self.assertEqual(extracted, text)

    def test_extract_core_rules_truncation(self):
        long_text = "\n".join(f"- Rule {i}: Some extensive explanation about cinema" for i in range(50))
        extracted = extract_core_rules(long_text, max_chars=200)
        self.assertLessEqual(len(extracted), 250)

    def test_get_genre_few_shots_matching(self):
        cinematic = get_genre_few_shots("hyperrealistic cinematic")
        self.assertIn("detective", cinematic)

        anime = get_genre_few_shots("vibrant anime style")
        self.assertIn("anime", anime.lower())

        retro = get_genre_few_shots("1980s retro vintage film")
        self.assertIn("1980s", retro)

    def test_retrieve_focused_prompt_guide_assembly(self):
        guide = retrieve_focused_prompt_guide(
            video_model="ltx-2.5",
            genre_or_style="cinematic",
            compact=True,
        )
        self.assertIn("FEW-SHOT EXAMPLES", guide)


if __name__ == "__main__":
    unittest.main()
