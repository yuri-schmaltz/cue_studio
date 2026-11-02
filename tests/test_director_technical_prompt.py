"""Tests for the separate technical-prompt field.

The Director briefing carries two different kinds of instruction: scenes
tied to a moment of the track, and technical direction that holds for
the whole film (fps, material, lighting, camera technique). The UI
exposes them as two fields; these tests pin down how they combine into
the global concept the planner receives.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services.director.planners.music_video import (  # noqa: E402
    _compose_global_concept,
    _compose_unanchored_concept,
    _resolve_global_concept,
)

SCENES = """### **CENA 1: A Introducao (0:00 - 0:11)**

- **Visual:** Plano macro de massinha.
- **0:00 - 0:05:** A mao esquerda se posiciona no braco do violao.
"""

TECHNICAL = "A cinematic 12-15 fps stop-motion claymation, warm studio lighting, fade out to black."


class ResolveGlobalConceptTests(unittest.TestCase):
    def test_technical_prompt_joins_an_anchored_briefing(self):
        concept, script = _resolve_global_concept(SCENES, TECHNICAL)
        self.assertIn("12-15 fps", concept)
        self.assertTrue(script["anchored"])
        self.assertEqual(len(script["scenes"]), 1)

    def test_scene_bodies_do_not_leak_into_the_global_concept(self):
        concept, _ = _resolve_global_concept(SCENES, TECHNICAL)
        # The shot plan belongs to the clip that owns the scene, not to
        # every prompt in the film.
        self.assertNotIn("Plano macro", concept)

    def test_explicit_technical_prompt_overrides_the_parsed_one(self):
        briefing = SCENES + "\n### **Prompt Tecnico:**\n\n- Antigo bloco tecnico.\n"
        concept, _ = _resolve_global_concept(briefing, TECHNICAL)
        self.assertIn("12-15 fps", concept)
        self.assertNotIn("Antigo bloco tecnico", concept)

    def test_parsed_technical_block_is_used_when_the_field_is_empty(self):
        briefing = SCENES + "\n### **Prompt Tecnico:**\n\n- Bloco tecnico antigo.\n"
        concept, _ = _resolve_global_concept(briefing, "")
        self.assertIn("Bloco tecnico antigo", concept)

    def test_unanchored_briefing_keeps_the_whole_text(self):
        concept, script = _resolve_global_concept("Um video de massinha.", TECHNICAL)
        self.assertIn("Um video de massinha", concept)
        self.assertIn("12-15 fps", concept)
        self.assertFalse(script["anchored"])

    def test_no_technical_prompt_leaves_the_concept_untouched(self):
        concept, _ = _resolve_global_concept(SCENES, "")
        self.assertNotIn("12-15 fps", concept)


class ComposeGlobalConceptTests(unittest.TestCase):
    def test_style_and_technical_blocks_are_both_kept(self):
        concept = _compose_global_concept({
            "global_style": "Estilo de massinha.",
            "global_technical": "12-15 fps.",
        })
        self.assertIn("Estilo de massinha", concept)
        self.assertIn("12-15 fps", concept)

    def test_empty_blocks_are_dropped(self):
        concept = _compose_global_concept({
            "global_style": "",
            "global_technical": "12-15 fps.",
        })
        self.assertEqual(concept, "12-15 fps.")

    def test_unanchored_concept_joins_both_parts(self):
        concept = _compose_unanchored_concept("Cenas soltas.", "12-15 fps.")
        self.assertIn("Cenas soltas.", concept)
        self.assertIn("12-15 fps.", concept)

    def test_unanchored_concept_without_technical_part(self):
        concept = _compose_unanchored_concept("Cenas soltas.", "")
        self.assertEqual(concept, "Cenas soltas.")


if __name__ == "__main__":
    unittest.main()
