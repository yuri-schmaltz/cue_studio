"""Tests for the time-anchored briefing parser and its reconciliation.

A Director briefing may describe only a slice of the uploaded track —
e.g. three scenes over 45 seconds of a 4:15 song. The parser turns that
text into scenes anchored to source time, and the reconciler reports how
much of the analysed audio the script actually covers.

Both live in :mod:`app.services.director.scene_script`.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services.director.scene_script import (  # noqa: E402
    beats_overlapping,
    parse_scene_script,
    reconcile_scene_script,
    scenes_overlapping,
    script_span,
)


BRIEFING = """STYLE & LOOK
Cinematic, anamorphic, 35mm grain, cold blue night exteriors.

CENA 1: A HARBOUR AT DUSK (0:00 - 0:11)
A slow dolly-in on a fishing boat. The narrator stands at the bow.

CENA 2: THE WHEELHOUSE (0:11 - 0:28)
Interior, single practical light. Hands on the ship's wheel.

CENA 3: THE SONG BEGINS (0:28 - 0:45)
Wide shot, the crew turns toward the light. "but if you only knew"
"""


class ParseSceneScriptTests(unittest.TestCase):
    def test_parses_scenes_with_timecodes(self):
        script = parse_scene_script(BRIEFING)
        self.assertTrue(script.anchored)
        self.assertEqual(len(script.scenes), 3)
        self.assertEqual(script.scenes[0].title, "A HARBOUR AT DUSK")
        self.assertAlmostEqual(script.scenes[0].start, 0.0)
        self.assertAlmostEqual(script.scenes[0].end, 11.0)
        self.assertAlmostEqual(script.scenes[1].start, 11.0)
        self.assertAlmostEqual(script.scenes[1].end, 28.0)
        self.assertAlmostEqual(script.scenes[2].start, 28.0)
        self.assertAlmostEqual(script.scenes[2].end, 45.0)

    def test_span_covers_first_to_last_scene(self):
        script = parse_scene_script(BRIEFING)
        self.assertIsNotNone(script.span)
        start, end = script.span  # type: ignore[misc]
        self.assertAlmostEqual(start, 0.0)
        self.assertAlmostEqual(end, 45.0)

    def test_global_style_is_kept_separate_from_scenes(self):
        script = parse_scene_script(BRIEFING)
        self.assertIn("STYLE & LOOK", script.global_style)
        self.assertNotIn("CENA 1", script.global_style)

    def test_quoted_lyrics_are_extracted(self):
        script = parse_scene_script(BRIEFING)
        self.assertIn("but if you only knew", script.scenes[2].quotes)
        # The literal quote must not leak into the plain body, so image
        # prompts never receive spoken words.
        self.assertNotIn('"but if you only knew"', script.scenes[2].body_plain)

    def test_prose_without_timecodes_is_not_anchored(self):
        script = parse_scene_script(
            "A quiet video of a woman walking through a field at sunset."
        )
        self.assertFalse(script.anchored)
        self.assertEqual(script.scenes, [])
        self.assertIsNone(script.span)

    def test_empty_text(self):
        script = parse_scene_script("")
        self.assertFalse(script.anchored)
        self.assertEqual(script.scenes, [])

    def test_scene_without_timecode_is_kept_but_unanchored(self):
        script = parse_scene_script(
            "CENA 1: OPENING\nA wide shot of a city.\n\nCENA 2: LATER (1:00 - 1:10)\nRain."
        )
        self.assertEqual(len(script.scenes), 2)
        self.assertIsNone(script.scenes[0].start)
        self.assertIsNone(script.scenes[0].end)
        self.assertAlmostEqual(script.scenes[1].start, 60.0)

    def test_minute_second_timecodes(self):
        script = parse_scene_script("CENA 1: LONG (1:02 - 1:45)\nSomething.")
        self.assertAlmostEqual(script.scenes[0].start, 62.0)
        self.assertAlmostEqual(script.scenes[0].end, 105.0)

    def test_english_scene_headers(self):
        script = parse_scene_script("SCENE 1: OPENING (0:00 - 0:10)\nWind.")
        self.assertEqual(len(script.scenes), 1)
        self.assertAlmostEqual(script.scenes[0].end, 10.0)

    def test_span_helper_matches_script(self):
        script = parse_scene_script(BRIEFING)
        self.assertEqual(script_span(script), script.span)


class ScenesOverlappingTests(unittest.TestCase):
    def test_finds_scene_covering_interval(self):
        script = parse_scene_script(BRIEFING)
        hits = scenes_overlapping(script, 12.0, 20.0)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["title"], "THE WHEELHOUSE")

    def test_finds_scene_crossing_boundary(self):
        script = parse_scene_script(BRIEFING)
        hits = scenes_overlapping(script, 8.0, 14.0)
        self.assertEqual(len(hits), 2)

    def test_no_scene_outside_script(self):
        script = parse_scene_script(BRIEFING)
        self.assertEqual(scenes_overlapping(script, 100.0, 120.0), [])

    def test_interval_without_anchored_scenes(self):
        script = parse_scene_script("Just a sentence.")
        self.assertEqual(scenes_overlapping(script, 0.0, 10.0), [])


class ReconcileSceneScriptTests(unittest.TestCase):
    def test_excerpt_status_when_script_covers_part_of_track(self):
        script = parse_scene_script(BRIEFING)
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "excerpt")
        self.assertEqual(report.scene_count, 3)
        self.assertEqual(report.anchored_scene_count, 3)
        self.assertAlmostEqual(report.audio_duration or 0, 255.0)
        self.assertAlmostEqual(report.covered_start or 0, 0.0)
        self.assertAlmostEqual(report.covered_end or 0, 45.0)
        self.assertAlmostEqual(report.covered_seconds or 0, 45.0)
        self.assertAlmostEqual(report.uncovered_seconds or 0, 210.0)
        self.assertLess(report.coverage_ratio or 0, 0.5)

    def test_full_track_status_when_script_covers_everything(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 2:00)\nOne.\n\nCENA 2: B (2:00 - 4:15)\nTwo."
        )
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "full_track")
        self.assertAlmostEqual(report.uncovered_seconds or 0, 0.0)
        self.assertGreater(report.coverage_ratio or 0, 0.99)

    def test_no_timecodes_status(self):
        script = parse_scene_script("A simple description.")
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "no_timecodes")
        self.assertIsNone(report.covered_start)

    def test_gaps_between_scenes_are_reported(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\nOne.\n\nCENA 2: B (0:30 - 0:45)\nTwo."
        )
        report = reconcile_scene_script(script, audio_duration=60.0)
        self.assertEqual(len(report.gaps), 1)
        self.assertAlmostEqual(report.gaps[0]["start"], 10.0)
        self.assertAlmostEqual(report.gaps[0]["end"], 30.0)

    def test_without_audio_duration_still_reports_span(self):
        script = parse_scene_script(BRIEFING)
        report = reconcile_scene_script(script, audio_duration=None)
        self.assertAlmostEqual(report.covered_end or 0, 45.0)
        self.assertIsNone(report.audio_duration)


SCREENPLAY = """# Roteiro Completo: "More Than Words" (04:15)

- **Estilo Visual e Direção:** Animacao de massinha, set escuro, fps de stop-motion.

### **CENA 1: A Introducao e o Setup (0:00 - 0:11)**

- **Visual:** Plano macro (close-up extremo) de massinha. A camera foca nas cordas.
- **0:00 - 0:05:** A mao esquerda de massinha de **Nuno** se posiciona no braco do violao.
- **0:05 - 0:11:** A camera faz um lento *pull-back* e sobe, revelando o rosto concentrado.

### **CENA 2: A Entrada de Gary (0:11 - 0:28)**

- **Visual:** Plano medio-conjunto mostrando os dois de corpo inteiro.
- **0:11 - 0:20:** A camera foca em **Gary**. Ele solta a primeira frase: *"Saying I love you"*.
- **0:20 - 0:28:** Detalhe no rosto de **Gary**, olhos semicerrados.

### **Prompt e Parametros Tecnicos de Geracao da IA:**

- **Prompt para IA (Consolidado):** `"A cinematic 12-15 fps stop-motion claymation video."`
"""


class ScreenplayFormatTests(unittest.TestCase):
    """The screenplay layout a user actually writes.

    Markdown headings, bold markers, a per-scene "Visual:" shot plan,
    time-anchored sub-beats and a trailing technical-prompt block.
    """

    def test_markdown_scene_headers_are_parsed(self):
        script = parse_scene_script(SCREENPLAY)
        self.assertTrue(script.anchored)
        self.assertEqual(len(script.scenes), 2)
        self.assertEqual(script.scenes[0].title, "A Introducao e o Setup")
        self.assertAlmostEqual(script.scenes[0].start, 0.0)
        self.assertAlmostEqual(script.scenes[0].end, 11.0)
        self.assertEqual(script.scenes[1].title, "A Entrada de Gary")
        self.assertAlmostEqual(script.scenes[1].start, 11.0)
        self.assertAlmostEqual(script.scenes[1].end, 28.0)

    def test_markdown_emphasis_is_stripped_from_the_title(self):
        script = parse_scene_script(SCREENPLAY)
        for scene in script.scenes:
            self.assertNotIn("*", scene.title)

    def test_visual_line_becomes_the_scene_shot_plan(self):
        script = parse_scene_script(SCREENPLAY)
        self.assertTrue(script.scenes[0].visual.startswith("Plano macro"))
        self.assertNotIn("**", script.scenes[0].visual)

    def test_sub_beats_are_parsed(self):
        script = parse_scene_script(SCREENPLAY)
        beats = script.scenes[0].beats
        self.assertEqual(len(beats), 2)
        self.assertAlmostEqual(beats[0].start, 0.0)
        self.assertAlmostEqual(beats[0].end, 5.0)
        self.assertAlmostEqual(beats[1].start, 5.0)
        self.assertAlmostEqual(beats[1].end, 11.0)
        self.assertIn("Nuno", beats[0].body_plain)

    def test_beats_carry_their_own_quotes(self):
        script = parse_scene_script(SCREENPLAY)
        self.assertIn("Saying I love you", script.scenes[1].beats[0].quotes)

    def test_technical_block_is_global_not_part_of_the_last_scene(self):
        script = parse_scene_script(SCREENPLAY)
        self.assertIn("Prompt e Parametros Tecnicos", script.global_technical)
        self.assertIn("12-15 fps", script.global_technical)
        self.assertNotIn("12-15 fps", script.scenes[-1].body)
        self.assertNotIn("12-15 fps", script.scenes[-1].body_plain)

    def test_style_block_stays_global(self):
        script = parse_scene_script(SCREENPLAY)
        self.assertIn("Estilo Visual", script.global_style)
        self.assertNotIn("CENA 1", script.global_style)

    def test_scene_without_a_range_takes_it_from_its_beats(self):
        script = parse_scene_script(
            "### **CENA 1: Sem faixa no titulo**\n"
            "- **0:30 - 0:40:** Acoes.\n"
        )
        scene = script.scenes[0]
        self.assertAlmostEqual(scene.start, 30.0)
        self.assertAlmostEqual(scene.end, 40.0)
        self.assertTrue(scene.anchored)

    def test_beats_overlapping_selects_the_covered_range(self):
        script = parse_scene_script(SCREENPLAY)
        scene = script.scenes[0]
        self.assertEqual(len(beats_overlapping(scene, 0.0, 11.0)), 2)
        self.assertEqual(len(beats_overlapping(scene, 0.0, 5.0)), 1)
        self.assertEqual(len(beats_overlapping(scene, 30.0, 40.0)), 0)

    def test_reconciliation_covers_the_full_script(self):
        script = parse_scene_script(SCREENPLAY)
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "excerpt")
        self.assertAlmostEqual(report.covered_start or 0, 0.0)
        self.assertAlmostEqual(report.covered_end or 0, 28.0)


if __name__ == "__main__":
    unittest.main()
