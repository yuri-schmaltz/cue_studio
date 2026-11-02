"""Exhaustive scenario matrix for the time-anchored Director briefing.

Covers the whole path a brief travels through:

    text → parse → reconcile → window → clip plan → per-clip binding → HTTP

Every entry states the scenario it pins down, so a failure names the
case instead of a line number. The matrix is deliberately broad: empty
and malformed input, every markdown flavour a user might paste, every
window position, and every overlap between a clip and the script.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services import audio_analysis  # noqa: E402
from services.director.planners.music_video import (  # noqa: E402
    _compose_global_concept,
    _resolve_global_concept,
)
from services.director.scene_script import (  # noqa: E402
    beats_overlapping,
    parse_scene_script,
    reconcile_scene_script,
    scenes_overlapping,
    script_span,
)

# ────────────────────────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────────────────────────

TECHNICAL = "A cinematic 12-15 fps stop-motion claymation, warm studio lighting."

SCREENPLAY = """# Roteiro Completo: "More Than Words" (04:15)

- **Estilo Visual e Direção:** Animacao de massinha, set escuro.

### **CENA 1: A Introducao e o Setup (0:00 - 0:11)**

- **Visual:** Plano macro de massinha.
- **0:00 - 0:05:** A mao esquerda se posiciona no braco do violao.
- **0:05 - 0:11:** A camera faz um lento pull-back.

### **CENA 2: A Entrada de Gary (0:11 - 0:28)**

- **Visual:** Plano medio-conjunto.
- **0:11 - 0:20:** A camera foca em Gary.
- **0:20 - 0:28:** Detalhe no rosto de Gary.

### **Prompt e Parametros Tecnicos de Geracao da IA:**

- **Prompt para IA:** `"A cinematic 12-15 fps stop-motion claymation video."`
"""


def _analysis(duration: float = 255.0, sections: int = 6):
    """A long track with evenly spread sections."""
    spans = []
    for i in range(sections):
        start = i * (duration / sections)
        end = (i + 1) * (duration / sections)
        spans.append({"start": start, "end": end, "label": "verse", "energy": 0.5})
    return {"bpm": 120.0, "beats": [], "sections": spans, "duration": duration}


# ────────────────────────────────────────────────────────────────────
# 1. Parser — input shapes
# ────────────────────────────────────────────────────────────────────


class ParserInputShapeTests(unittest.TestCase):
    """What the parser does with every shape of input."""

    def test_empty_string(self):
        script = parse_scene_script("")
        self.assertEqual(script.scenes, [])
        self.assertFalse(script.anchored)
        self.assertEqual(script.global_style, "")
        self.assertEqual(script.global_technical, "")

    def test_whitespace_only(self):
        script = parse_scene_script("   \n\t\n  ")
        self.assertEqual(script.scenes, [])
        self.assertFalse(script.anchored)

    def test_none_input(self):
        script = parse_scene_script(None)  # type: ignore[arg-type]
        self.assertEqual(script.scenes, [])

    def test_single_prose_sentence(self):
        script = parse_scene_script("Uma mulher anda num campo ao entardecer.")
        self.assertFalse(script.anchored)
        self.assertEqual(script.scenes, [])
        self.assertIn("campo", script.global_style)

    def test_prose_with_the_word_scene_but_no_number(self):
        script = parse_scene_script("A scene of two people talking.")
        self.assertFalse(script.anchored)

    def test_prose_containing_the_word_cena_in_the_middle(self):
        script = parse_scene_script("O filme mostra a cena final do dia.")
        self.assertFalse(script.anchored)

    def test_numbered_list_is_not_a_scene(self):
        script = parse_scene_script("1. Primeiro item\n2. Segundo item")
        self.assertFalse(script.anchored)

    def test_crlf_line_endings(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:10)\r\nCorpo.\r\n")
        self.assertEqual(len(script.scenes), 1)
        self.assertAlmostEqual(script.scenes[0].end, 10.0)

    def test_tabs_and_mixed_indentation(self):
        script = parse_scene_script("\tCENA 1: A (0:00 - 0:10)\n\t\tCorpo.")
        self.assertEqual(len(script.scenes), 1)

    def test_very_long_scene_body(self):
        body = "\n".join(f"Linha {i} com texto." for i in range(500))
        script = parse_scene_script(f"CENA 1: A (0:00 - 0:10)\n{body}")
        self.assertEqual(len(script.scenes), 1)
        self.assertIn("Linha 499", script.scenes[0].body)

    def test_unicode_and_accents(self):
        script = parse_scene_script("CENA 1: Ação — Coração (0:00 - 0:10)\nCoração.")
        self.assertEqual(script.scenes[0].title, "Ação — Coração")


# ────────────────────────────────────────────────────────────────────
# 2. Parser — header formats
# ────────────────────────────────────────────────────────────────────


class ParserHeaderFormatTests(unittest.TestCase):
    """Every spelling of a scene header a user might write."""

    def test_plain_header_with_colon(self):
        script = parse_scene_script("CENA 1: Nome (0:00 - 0:10)\nCorpo.")
        self.assertEqual(script.scenes[0].title, "Nome")

    def test_plain_header_with_dash(self):
        script = parse_scene_script("CENA 1 - Nome (0:00 - 0:10)\nCorpo.")
        self.assertEqual(script.scenes[0].title, "Nome")

    def test_english_scene_keyword(self):
        script = parse_scene_script("SCENE 3: Name (0:00 - 0:10)\nBody.")
        self.assertEqual(len(script.scenes), 1)
        self.assertAlmostEqual(script.scenes[0].start, 0.0)

    def test_spanish_scene_keyword(self):
        script = parse_scene_script("ESCENA 2: Nombre (0:00 - 0:10)\nCuerpo.")
        self.assertEqual(len(script.scenes), 1)

    def test_chapter_keyword(self):
        script = parse_scene_script("CAPITULO 1: Nome (0:00 - 0:10)\nCorpo.")
        self.assertEqual(len(script.scenes), 1)

    def test_markdown_heading_prefix(self):
        script = parse_scene_script("### CENA 1: Nome (0:00 - 0:10)\nCorpo.")
        self.assertEqual(len(script.scenes), 1)
        self.assertEqual(script.scenes[0].title, "Nome")

    def test_markdown_heading_with_bold(self):
        script = parse_scene_script("### **CENA 1: Nome (0:00 - 0:10)**\nCorpo.")
        self.assertEqual(len(script.scenes), 1)
        self.assertEqual(script.scenes[0].title, "Nome")
        self.assertNotIn("*", script.scenes[0].title)

    def test_bold_without_heading(self):
        script = parse_scene_script("**CENA 1: Nome (0:00 - 0:10)**\nCorpo.")
        self.assertEqual(len(script.scenes), 1)

    def test_underscore_emphasis(self):
        script = parse_scene_script("### __CENA 1: Nome (0:00 - 0:10)__\nCorpo.")
        self.assertEqual(len(script.scenes), 1)

    def test_header_without_a_title(self):
        script = parse_scene_script("CENA 1: (0:00 - 0:10)\nCorpo.")
        self.assertEqual(len(script.scenes), 1)
        self.assertEqual(script.scenes[0].title, "")

    def test_header_without_a_range(self):
        script = parse_scene_script("CENA 1: Nome\nCorpo.")
        self.assertEqual(len(script.scenes), 1)
        self.assertIsNone(script.scenes[0].start)
        self.assertIsNone(script.scenes[0].end)

    def test_range_in_brackets(self):
        script = parse_scene_script("CENA 1: Nome [0:00 - 0:10]\nCorpo.")
        self.assertAlmostEqual(script.scenes[0].end, 10.0)

    def test_range_with_the_word_to(self):
        script = parse_scene_script("CENA 1: Name (0:00 to 0:10)\nBody.")
        self.assertAlmostEqual(script.scenes[0].end, 10.0)

    def test_range_with_ate(self):
        script = parse_scene_script("CENA 1: Nome (0:00 até 0:10)\nCorpo.")
        self.assertAlmostEqual(script.scenes[0].end, 10.0)

    def test_range_with_en_dash(self):
        script = parse_scene_script("CENA 1: Nome (0:00 – 0:10)\nCorpo.")
        self.assertAlmostEqual(script.scenes[0].end, 10.0)

    def test_range_in_hours_minutes_seconds(self):
        script = parse_scene_script("CENA 1: Nome (0:01:30 - 0:02:00)\nCorpo.")
        self.assertAlmostEqual(script.scenes[0].start, 90.0)
        self.assertAlmostEqual(script.scenes[0].end, 120.0)

    def test_plain_seconds_range(self):
        script = parse_scene_script("CENA 1: Nome (0 - 10)\nCorpo.")
        self.assertAlmostEqual(script.scenes[0].start, 0.0)
        self.assertAlmostEqual(script.scenes[0].end, 10.0)

    def test_minute_second_range_above_an_hour(self):
        script = parse_scene_script("CENA 1: Nome (4:15 - 5:00)\nCorpo.")
        self.assertAlmostEqual(script.scenes[0].start, 255.0)

    def test_inverted_range_is_dropped(self):
        script = parse_scene_script("CENA 1: Nome (0:30 - 0:10)\nCorpo.")
        self.assertIsNone(script.scenes[0].start)
        self.assertIsNone(script.scenes[0].end)

    def test_zero_length_range_is_dropped(self):
        script = parse_scene_script("CENA 1: Nome (0:10 - 0:10)\nCorpo.")
        self.assertIsNone(script.scenes[0].start)

    def test_out_of_order_scene_numbers_keep_their_order(self):
        script = parse_scene_script(
            "CENA 3: Terceira (0:20 - 0:30)\nC.\n\nCENA 1: Primeira (0:00 - 0:10)\nA."
        )
        self.assertEqual([s.index for s in script.scenes], [3, 1])

    def test_duplicate_scene_numbers_are_kept(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\nX.\n\nCENA 1: B (0:10 - 0:20)\nY."
        )
        self.assertEqual(len(script.scenes), 2)

    def test_scene_without_number_is_not_a_scene(self):
        script = parse_scene_script("CENA: Nome (0:00 - 0:10)\nCorpo.")
        self.assertEqual(script.scenes, [])


# ────────────────────────────────────────────────────────────────────
# 3. Parser — body structure
# ────────────────────────────────────────────────────────────────────


class ParserBodyStructureTests(unittest.TestCase):
    """Visual lines, sub-beats and the technical block."""

    def test_visual_line_is_captured(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:10)\n- **Visual:** Plano macro.\n- Resto.")
        self.assertEqual(script.scenes[0].visual, "Plano macro.")

    def test_visual_line_without_bullet(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:10)\nVisual: Plano macro.")
        self.assertEqual(script.scenes[0].visual, "Plano macro.")

    def test_visual_line_portuguese_synonym(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:10)\n- **Enquadramento:** Plano geral.")
        self.assertEqual(script.scenes[0].visual, "Plano geral.")

    def test_only_the_first_visual_line_is_kept(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\n- **Visual:** Primeiro.\n- **Visual:** Segundo."
        )
        self.assertEqual(script.scenes[0].visual, "Primeiro.")

    def test_sub_beats_are_captured(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\n- **0:00 - 0:05:** Primeira metade.\n- **0:05 - 0:10:** Segunda."
        )
        beats = script.scenes[0].beats
        self.assertEqual(len(beats), 2)
        self.assertAlmostEqual(beats[0].end, 5.0)
        self.assertAlmostEqual(beats[1].start, 5.0)

    def test_beats_carry_their_own_quotes(self):
        script = parse_scene_script(
            'CENA 1: A (0:00 - 0:10)\n- **0:00 - 0:05:** Ele canta *"a lyric here"*.'
        )
        self.assertIn("a lyric here", script.scenes[0].beats[0].quotes)

    def test_beats_outside_the_scene_range_are_kept(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\n- **0:20 - 0:30:** Fora do intervalo."
        )
        self.assertEqual(len(script.scenes[0].beats), 1)

    def test_inverted_beat_is_not_a_beat(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\n- **0:30 - 0:20:** Invertido."
        )
        self.assertEqual(script.scenes[0].beats, [])

    def test_a_range_in_prose_is_not_a_beat(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\nO Chord Crona a partir de 12 - 15 casas."
        )
        self.assertEqual(script.scenes[0].beats, [])

    def test_scene_without_a_range_inherits_it_from_the_beats(self):
        script = parse_scene_script("CENA 1: Sem faixa\n- **0:30 - 0:40:** Acao.")
        scene = script.scenes[0]
        self.assertAlmostEqual(scene.start, 30.0)
        self.assertAlmostEqual(scene.end, 40.0)

    def test_scene_with_a_range_keeps_it_over_the_beats(self):
        script = parse_scene_script("CENA 1: Com faixa (0:00 - 0:20)\n- **0:00 - 0:05:** Acao.")
        self.assertAlmostEqual(script.scenes[0].end, 20.0)

    def test_technical_block_is_separated(self):
        script = parse_scene_script(SCREENPLAY)
        self.assertIn("12-15 fps", script.global_technical)
        self.assertNotIn("12-15 fps", script.scenes[-1].body_plain)

    def test_technical_block_before_the_scenes_is_still_global(self):
        script = parse_scene_script(
            "### **Prompt Tecnico:**\n\n- 12-15 fps.\n\n### **CENA 1: A (0:00 - 0:10)**\nCorpo."
        )
        self.assertIn("12-15 fps", script.global_technical)

    def test_technical_block_in_the_middle_stops_the_scene(self):
        script = parse_scene_script(
            "### **CENA 1: A (0:00 - 0:10)**\nCorpo.\n\n"
            "### **Prompt Tecnico:**\n\n- 12-15 fps.\n\n"
            "### **CENA 2: B (0:10 - 0:20)**\nCorpo."
        )
        # The scene after the technical block is a new scene; the block
        # does not swallow it.
        self.assertEqual(len(script.scenes), 2)
        self.assertIn("12-15 fps", script.global_technical)

    def test_prose_mentioning_prompt_does_not_open_a_technical_block(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\nO prompt que o modelo recebe deve descrever o set."
        )
        self.assertEqual(script.global_technical, "")
        self.assertEqual(len(script.scenes), 1)

    def test_quotes_are_extracted_from_the_residual_body(self):
        script = parse_scene_script('CENA 1: A (0:00 - 0:10)\nEle diz "uma frase".')
        self.assertIn("uma frase", script.scenes[0].quotes)
        self.assertNotIn('"uma frase"', script.scenes[0].body_plain)

    def test_curly_quotes_are_extracted(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:10)\nEle diz “uma frase”.")
        self.assertIn("uma frase", script.scenes[0].quotes)

    def test_style_preamble_is_kept_apart_from_the_scenes(self):
        script = parse_scene_script(SCREENPLAY)
        self.assertIn("Estilo Visual", script.global_style)
        self.assertNotIn("Estilo Visual", script.scenes[0].body_plain)


# ────────────────────────────────────────────────────────────────────
# 4. Reconciliation
# ────────────────────────────────────────────────────────────────────


class ReconciliationMatrixTests(unittest.TestCase):
    """How the script compares against the real audio length."""

    def test_full_track(self):
        script = parse_scene_script("CENA 1: A (0:00 - 4:15)\nCorpo.")
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "full_track")
        self.assertAlmostEqual(report.uncovered_seconds or 0, 0.0)
        self.assertAlmostEqual(report.coverage_ratio or 0, 1.0, places=3)

    def test_excerpt(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:45)\nCorpo.")
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "excerpt")
        self.assertAlmostEqual(report.coverage_ratio or 0, 45 / 255, places=3)

    def test_no_timecodes(self):
        script = parse_scene_script("Apenas uma descricao.")
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "no_timecodes")
        self.assertIsNone(report.covered_start)

    def test_without_audio_duration_the_span_is_still_reported(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:45)\nCorpo.")
        report = reconcile_scene_script(script, audio_duration=None)
        self.assertAlmostEqual(report.covered_end or 0, 45.0)
        self.assertIsNone(report.audio_duration)
        self.assertIsNone(report.coverage_ratio)

    def test_zero_audio_duration(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:45)\nCorpo.")
        report = reconcile_scene_script(script, audio_duration=0.0)
        self.assertIsNone(report.audio_duration)
        self.assertAlmostEqual(report.covered_end or 0, 45.0)

    def test_negative_audio_duration_is_treated_as_unknown(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:45)\nCorpo.")
        report = reconcile_scene_script(script, audio_duration=-10.0)
        self.assertIsNone(report.audio_duration)

    def test_invalid_audio_duration_is_treated_as_unknown(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:45)\nCorpo.")
        report = reconcile_scene_script(script, audio_duration="abc")  # type: ignore[arg-type]
        self.assertIsNone(report.audio_duration)

    def test_script_longer_than_the_audio_is_capped(self):
        script = parse_scene_script("CENA 1: A (0:00 - 10:00)\nCorpo.")
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "full_track")
        self.assertAlmostEqual(report.coverage_ratio or 0, 1.0, places=3)

    def test_gap_between_scenes_is_reported(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\nX.\n\nCENA 2: B (0:30 - 0:45)\nY."
        )
        report = reconcile_scene_script(script, audio_duration=60.0)
        self.assertEqual(len(report.gaps), 1)
        self.assertAlmostEqual(report.gaps[0]["start"], 10.0)
        self.assertAlmostEqual(report.gaps[0]["end"], 30.0)

    def test_adjacent_scenes_have_no_gap(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\nX.\n\nCENA 2: B (0:10 - 0:20)\nY."
        )
        report = reconcile_scene_script(script, audio_duration=60.0)
        self.assertEqual(report.gaps, [])

    def test_unanchored_scenes_count_separately(self):
        script = parse_scene_script(
            "CENA 1: Sem faixa\nX.\n\nCENA 2: Com faixa (0:10 - 0:20)\nY."
        )
        report = reconcile_scene_script(script, audio_duration=60.0)
        self.assertEqual(report.scene_count, 2)
        self.assertEqual(report.anchored_scene_count, 1)

    def test_span_helper_matches_the_report(self):
        script = parse_scene_script("CENA 1: A (0:05 - 0:15)\nCorpo.")
        self.assertEqual(script_span(script), (5.0, 15.0))

    def test_span_helper_on_an_empty_script(self):
        self.assertIsNone(script_span(parse_scene_script("")))

    def test_reconciliation_accepts_the_dict_form(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:45)\nCorpo.").to_dict()
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "excerpt")


# ────────────────────────────────────────────────────────────────────
# 5. Clip plan window
# ────────────────────────────────────────────────────────────────────


class ClipWindowMatrixTests(unittest.TestCase):
    """Every window position against the analysed track."""

    def test_no_window_covers_the_whole_track(self):
        clips = audio_analysis.plan_clip_structure(_analysis())
        self.assertAlmostEqual(min(c["start"] for c in clips), 0.0, places=3)
        self.assertAlmostEqual(max(c["end"] for c in clips), 255.0, places=3)

    def test_window_at_the_start(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=0.0, window_end=45.0)
        self.assertGreater(len(clips), 0)
        self.assertAlmostEqual(max(c["end"] for c in clips), 45.0, places=3)

    def test_window_at_the_end(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=210.0, window_end=255.0)
        self.assertAlmostEqual(min(c["start"] for c in clips), 210.0, places=3)

    def test_window_in_the_middle(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=78.0, window_end=134.0)
        self.assertAlmostEqual(min(c["start"] for c in clips), 78.0, places=3)
        self.assertAlmostEqual(max(c["end"] for c in clips), 134.0, places=3)

    def test_window_past_the_track_is_clamped(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=240.0, window_end=999.0)
        for clip in clips:
            self.assertLessEqual(clip["end"], 255.0 + 1e-6)

    def test_window_before_the_track_is_clamped(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=-10.0, window_end=20.0)
        self.assertAlmostEqual(min(c["start"] for c in clips), 0.0, places=3)

    def test_empty_window_yields_no_clips(self):
        self.assertEqual(
            audio_analysis.plan_clip_structure(_analysis(), window_start=45.0, window_end=45.0), []
        )

    def test_inverted_window_yields_no_clips(self):
        self.assertEqual(
            audio_analysis.plan_clip_structure(_analysis(), window_start=90.0, window_end=30.0), []
        )

    def test_window_shorter_than_a_clip_yields_no_clips(self):
        self.assertEqual(
            audio_analysis.plan_clip_structure(_analysis(), window_start=0.0, window_end=0.001), []
        )

    def test_only_the_start_is_given(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=200.0)
        self.assertAlmostEqual(min(c["start"] for c in clips), 200.0, places=3)
        self.assertAlmostEqual(max(c["end"] for c in clips), 255.0, places=3)

    def test_only_the_end_is_given(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_end=45.0)
        self.assertAlmostEqual(min(c["start"] for c in clips), 0.0, places=3)
        self.assertAlmostEqual(max(c["end"] for c in clips), 45.0, places=3)

    def test_window_equal_to_the_track_duration(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=0.0, window_end=255.0)
        self.assertAlmostEqual(max(c["end"] for c in clips), 255.0, places=3)

    def test_window_on_a_track_without_sections(self):
        analysis = {"bpm": 120.0, "beats": [], "sections": [], "duration": 60.0}
        clips = audio_analysis.plan_clip_structure(analysis, window_start=0.0, window_end=20.0)
        self.assertGreater(len(clips), 0)
        self.assertLessEqual(max(c["end"] for c in clips), 20.0 + 1e-6)

    def test_window_on_a_track_with_zero_bpm(self):
        analysis = {"bpm": 0.0, "beats": [], "sections": [{"start": 0.0, "end": 30.0, "label": "v", "energy": 0.5}], "duration": 30.0}
        clips = audio_analysis.plan_clip_structure(analysis, window_start=0.0, window_end=15.0)
        self.assertGreater(len(clips), 0)
        self.assertLessEqual(max(c["end"] for c in clips), 15.0 + 1e-6)

    def test_window_on_a_track_with_zero_duration(self):
        analysis = {"bpm": 120.0, "beats": [], "sections": [{"start": 0.0, "end": 30.0, "label": "v", "energy": 0.5}], "duration": 0.0}
        self.assertEqual(
            audio_analysis.plan_clip_structure(analysis, window_start=0.0, window_end=15.0), []
        )

    def test_fractional_window_bounds_are_preserved(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=10.7, window_end=20.3)
        self.assertAlmostEqual(min(c["start"] for c in clips), 10.7, places=3)
        self.assertAlmostEqual(max(c["end"] for c in clips), 20.3, places=3)

    def test_clips_stay_inside_the_window(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=30.0, window_end=90.0)
        for clip in clips:
            self.assertGreaterEqual(clip["start"], 30.0 - 1e-6)
            self.assertLessEqual(clip["end"], 90.0 + 1e-6)

    def test_clips_keep_absolute_source_times(self):
        clips = audio_analysis.plan_clip_structure(_analysis(), window_start=78.0, window_end=134.0)
        # Absolute times are what lets the pipeline slice the original
        # soundtrack at the right offset.
        self.assertGreater(min(c["start"] for c in clips), 0.0)

    def test_a_windowed_plan_has_fewer_clips_than_a_full_one(self):
        full = audio_analysis.plan_clip_structure(_analysis())
        windowed = audio_analysis.plan_clip_structure(_analysis(), window_start=0.0, window_end=45.0)
        self.assertLess(len(windowed), len(full))


# ────────────────────────────────────────────────────────────────────
# 6. Per-clip binding
# ────────────────────────────────────────────────────────────────────


class ClipBindingMatrixTests(unittest.TestCase):
    """Which scene a clip belongs to."""

    def setUp(self):
        self.script = parse_scene_script(SCREENPLAY).to_dict()

    def test_clip_inside_one_scene(self):
        hits = scenes_overlapping(self.script, 12.0, 20.0)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["index"], 2)

    def test_clip_overlapping_two_scenes(self):
        hits = scenes_overlapping(self.script, 8.0, 14.0)
        self.assertEqual(len(hits), 2)

    def test_clip_outside_every_scene(self):
        self.assertEqual(scenes_overlapping(self.script, 250.0, 255.0), [])

    def test_clip_covering_the_whole_script(self):
        hits = scenes_overlapping(self.script, 0.0, 28.0)
        self.assertEqual(len(hits), 2)

    def test_clip_at_a_scene_boundary_touches_only_one(self):
        hits = scenes_overlapping(self.script, 11.0, 12.0)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["index"], 2)

    def test_zero_length_interval_inside_a_scene_matches_it(self):
        # A point in time that falls inside a scene overlaps that scene.
        hits = scenes_overlapping(self.script, 5.0, 5.0)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["index"], 1)

    def test_invalid_interval_matches_nothing(self):
        self.assertEqual(scenes_overlapping(self.script, "x", None), [])  # type: ignore[arg-type]

    def test_beats_within_the_scene(self):
        scene = self.script["scenes"][0]
        self.assertEqual(len(beats_overlapping(scene, 0.0, 11.0)), 2)
        self.assertEqual(len(beats_overlapping(scene, 0.0, 5.0)), 1)
        self.assertEqual(len(beats_overlapping(scene, 30.0, 40.0)), 0)

    def test_binding_accepts_the_dataclass_form(self):
        scene = parse_scene_script(SCREENPLAY).scenes[0]
        self.assertEqual(len(beats_overlapping(scene, 0.0, 11.0)), 2)

    def test_binding_of_a_scene_without_beats(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:10)\nCorpo.").to_dict()
        self.assertEqual(beats_overlapping(script["scenes"][0], 0.0, 10.0), [])


# ────────────────────────────────────────────────────────────────────
# 7. Global concept composition
# ────────────────────────────────────────────────────────────────────


class GlobalConceptMatrixTests(unittest.TestCase):
    """What the planner receives as the film-wide direction."""

    def test_anchored_script_keeps_the_scenes_out_of_the_concept(self):
        concept, script = _resolve_global_concept(SCREENPLAY, "")
        self.assertTrue(script["anchored"])
        self.assertNotIn("Plano macro", concept)

    def test_technical_prompt_joins_the_concept(self):
        concept, _ = _resolve_global_concept(SCREENPLAY, TECHNICAL)
        self.assertIn("12-15 fps", concept)

    def test_explicit_technical_prompt_wins_over_the_parsed_block(self):
        concept, _ = _resolve_global_concept(SCREENPLAY, "PROMPT EXPLICITO")
        self.assertIn("PROMPT EXPLICITO", concept)
        self.assertNotIn("A cinematic 12-15 fps stop-motion claymation video.", concept)

    def test_parsed_block_is_used_when_the_field_is_empty(self):
        concept, _ = _resolve_global_concept(SCREENPLAY, "")
        self.assertIn("A cinematic 12-15 fps stop-motion claymation video.", concept)

    def test_unanchored_script_keeps_the_whole_text(self):
        concept, script = _resolve_global_concept("Um video de massinha.", TECHNICAL)
        self.assertFalse(script["anchored"])
        self.assertIn("Um video de massinha", concept)
        self.assertIn("12-15 fps", concept)

    def test_compose_skips_empty_blocks(self):
        self.assertEqual(
            _compose_global_concept({"global_style": "", "global_technical": ""}), ""
        )

    def test_compose_joins_both_blocks(self):
        concept = _compose_global_concept({
            "global_style": "Estilo.",
            "global_technical": "Tecnico.",
        })
        self.assertIn("Estilo.", concept)
        self.assertIn("Tecnico.", concept)


# ────────────────────────────────────────────────────────────────────
# 8. End to end
# ────────────────────────────────────────────────────────────────────


class EndToEndMatrixTests(unittest.TestCase):
    """The whole path, for the cases that matter in practice."""

    def test_excerpt_script_on_a_long_track(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:11)\nCorpo.\n\nCENA 2: B (0:11 - 0:45)\nCorpo."
        )
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "excerpt")

        clips = audio_analysis.plan_clip_structure(
            _analysis(), window_start=0.0, window_end=report.covered_end
        )
        self.assertGreater(len(clips), 0)
        self.assertLess(len(clips), len(audio_analysis.plan_clip_structure(_analysis())))
        for clip in clips:
            self.assertLessEqual(clip["end"], 45.0 + 1e-6)

    def test_full_script_on_a_matching_track(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 2:00)\nCorpo.\n\nCENA 2: B (2:00 - 4:15)\nCorpo."
        )
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertEqual(report.status, "full_track")
        clips = audio_analysis.plan_clip_structure(_analysis())
        self.assertGreater(len(clips), 1)

    def test_screenplay_brief_binds_every_clip_inside_its_span(self):
        script = parse_scene_script(SCREENPLAY).to_dict()
        span = script_span(script)
        self.assertIsNotNone(span)
        clips = audio_analysis.plan_clip_structure(_analysis())
        inside = 0
        outside = 0
        span_end = span[1] if span else 0.0
        for clip in clips:
            hits = scenes_overlapping(script, clip["start"], clip["end"])
            if clip["start"] < span_end:
                # The clip starts inside the scripted span, so it binds to
                # at least one scene — even when it straddles the end.
                inside += 1
                self.assertGreaterEqual(len(hits), 1)
            else:
                outside += 1
                self.assertEqual(len(hits), 0)
        # The brief covers 28s of a 255s track: some clips bind, the
        # rest are the unscripted tail.
        self.assertGreater(inside, 0)
        self.assertGreater(outside, 0)

    def test_a_script_that_ends_early_leaves_the_tail_uncovered(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:45)\nCorpo.")
        report = reconcile_scene_script(script, audio_duration=255.0)
        self.assertAlmostEqual(report.uncovered_seconds or 0, 210.0, places=3)


class TrailingTechnicalBlockTests(unittest.TestCase):
    """A technical prompt pasted without a heading.

    Screenplays often end with the consolidated technical prompt as a
    bare quoted paragraph. Without detection it stays glued to the last
    scene and applies to a single clip.
    """

    TRAILING = (
        "CENA 1: A (0:00 - 0:10)\nCorpo.\n\n"
        '"' + ("A cinematic 12-15 fps stop-motion claymation video, "
               "hand-crafted plasticine aesthetics with visible fingerprints, "
               "warm studio lighting with dramatic chiaroscuro, natural camera "
               "shake, and a cinematic camera fade-out to black at the end. " * 2)
        + '"'
    )

    def test_trailing_quoted_block_becomes_global(self):
        script = parse_scene_script(self.TRAILING)
        self.assertIn("12-15 fps", script.global_technical)
        self.assertNotIn("12-15 fps", script.scenes[-1].body_plain)

    def test_the_last_scene_keeps_its_own_content(self):
        script = parse_scene_script(
            self.TRAILING.replace("CENA 1: A (0:00 - 0:10)\nCorpo.",
                                  "CENA 1: A (0:00 - 0:10)\n- **Visual:** Plano macro.\n"
                                  "- **0:00 - 0:05:** Acao.")
        )
        scene = script.scenes[-1]
        self.assertEqual(scene.visual, "Plano macro.")
        self.assertEqual(len(scene.beats), 1)

    def test_a_short_quoted_lyric_is_not_taken(self):
        script = parse_scene_script(
            'CENA 1: A (0:00 - 0:10)\nEle canta "uma letra curta".'
        )
        self.assertEqual(script.global_technical, "")
        self.assertIn("uma letra curta", script.scenes[0].quotes)

    def test_a_quoted_block_in_the_middle_is_not_taken(self):
        script = parse_scene_script(
            'CENA 1: A (0:00 - 0:10)\n'
            '"' + ("texto longo " * 40) + '"\n\n'
            'CENA 2: B (0:10 - 0:20)\nCorpo.'
        )
        self.assertEqual(script.global_technical, "")

    def test_an_unquoted_trailing_paragraph_stays_in_the_scene(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:10)\nCorpo.\n\n"
            + "Nota tecnica sem aspas " * 20
        )
        self.assertEqual(script.global_technical, "")
        self.assertIn("Nota tecnica", script.scenes[-1].body_plain)


if __name__ == "__main__":
    unittest.main()
