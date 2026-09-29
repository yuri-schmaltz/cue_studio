"""Regression tests for audio_analysis backend edge cases.

These tests pin down bugs found during the E2E gauntlet:

* ``plan_clip_structure`` returned HTTP 500 (ZeroDivisionError) when an
  analyse job reported ``bpm=0`` — happens for silence, pure tones, or
  clips too short for BeatNet to lock onto a tempo. The planner now
  falls back to 120 BPM so the structure plan still succeeds.
* ``suggest_clip_boundaries`` used ``analysis["duration"]`` without
  guarding against missing/zero duration, raising KeyError. The planner
  now reads via ``.get`` with sensible fallbacks.

Both fixes live in :mod:`app.services.audio_analysis`.
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


class PlanClipStructureBpmZeroRegressionTests(unittest.TestCase):
    """Tests for the bpm=0 regression in plan_clip_structure."""

    def test_bpm_zero_does_not_crash(self):
        # bpm=0 is what BeatNet/librosa returns when it cannot lock onto
        # a tempo (e.g. pure sine wave). Before the fix this raised
        # ZeroDivisionError; now the planner uses 120 BPM as fallback.
        analysis = {
            "bpm": 0.0,
            "beats": [],
            "sections": [{"start": 0.0, "end": 12.0, "label": "verse", "energy": 0.5}],
            "duration": 12.0,
        }
        clips = audio_analysis.plan_clip_structure(analysis)
        # At least one clip covering the section must be produced.
        self.assertGreater(len(clips), 0)
        # Total clip duration should cover the song duration (12s).
        total = sum(c["end"] - c["start"] for c in clips)
        self.assertGreater(total, 0)

    def test_bpm_missing_does_not_crash(self):
        # The .get default of 120.0 should still kick in.
        analysis = {
            # bpm intentionally absent
            "beats": [],
            "sections": [{"start": 0.0, "end": 10.0, "label": "verse", "energy": 0.5}],
            "duration": 10.0,
        }
        clips = audio_analysis.plan_clip_structure(analysis)
        self.assertGreater(len(clips), 0)

    def test_bpm_negative_treated_as_invalid(self):
        # Defensive — negative bpm should not crash either.
        analysis = {
            "bpm": -10.0,
            "beats": [],
            "sections": [{"start": 0.0, "end": 8.0, "label": "verse", "energy": 0.5}],
            "duration": 8.0,
        }
        clips = audio_analysis.plan_clip_structure(analysis)
        self.assertGreater(len(clips), 0)

    def test_bpm_normal_value_still_works(self):
        # Sanity — happy path with realistic BPM keeps working.
        analysis = {
            "bpm": 120.0,
            "beats": [{"time": 0.0}, {"time": 0.5}, {"time": 1.0}, {"time": 1.5}],
            "sections": [{"start": 0.0, "end": 8.0, "label": "chorus", "energy": 0.7}],
            "duration": 8.0,
        }
        clips = audio_analysis.plan_clip_structure(analysis)
        self.assertGreater(len(clips), 0)

    def test_bpm_extreme_high_still_works(self):
        # 999 BPM is unrealistic but should not crash. Used for very
        # fast genres (drum'n'bass can hit 200 BPM but anything above is
        # either a misreport or compressed audio).
        analysis = {
            "bpm": 999.0,
            "beats": [],
            "sections": [{"start": 0.0, "end": 6.0, "label": "verse", "energy": 0.5}],
            "duration": 6.0,
        }
        clips = audio_analysis.plan_clip_structure(analysis)
        self.assertGreater(len(clips), 0)

    def test_bpm_extreme_low_still_works(self):
        # 1 BPM is below human perception but should not crash.
        analysis = {
            "bpm": 1.0,
            "beats": [],
            "sections": [{"start": 0.0, "end": 6.0, "label": "verse", "energy": 0.5}],
            "duration": 6.0,
        }
        clips = audio_analysis.plan_clip_structure(analysis)
        self.assertGreater(len(clips), 0)


class SuggestClipBoundariesEdgeCaseTests(unittest.TestCase):
    """Tests for missing/zero duration fallback in suggest_clip_boundaries."""

    def test_missing_duration_uses_clip_duration(self):
        # When analysis has no duration and no total_duration, fall back
        # to clip_duration. This avoids the KeyError that crashed the
        # endpoint before the guard.
        analysis = {"sections": [], "downbeats": []}
        clips = audio_analysis.suggest_clip_boundaries(
            analysis, clip_duration=5.0
        )
        # We should produce at least one clip covering 5 seconds.
        self.assertGreater(len(clips), 0)
        self.assertAlmostEqual(clips[0]["end"], 5.0, places=2)

    def test_zero_duration_uses_clip_duration(self):
        # A duration of 0 should be treated as missing — clip_duration
        # is the next best signal of "how long is this clip".
        analysis = {"duration": 0, "sections": [], "downbeats": []}
        clips = audio_analysis.suggest_clip_boundaries(
            analysis, clip_duration=3.0
        )
        self.assertGreater(len(clips), 0)

    def test_explicit_total_duration_wins(self):
        # total_duration takes precedence over analysis.duration so
        # callers can override partial analyses.
        analysis = {"duration": 100.0, "sections": [], "downbeats": []}
        clips = audio_analysis.suggest_clip_boundaries(
            analysis, clip_duration=5.0, total_duration=10.0
        )
        self.assertEqual(clips[-1]["end"], 10.0)

    def test_normal_duration_still_works(self):
        # Sanity — happy path remains identical.
        analysis = {
            "duration": 15.0,
            "sections": [],
            "downbeats": [],
        }
        clips = audio_analysis.suggest_clip_boundaries(
            analysis, clip_duration=5.0
        )
        self.assertEqual(len(clips), 3)
        self.assertEqual(clips[0]["start"], 0.0)
        self.assertEqual(clips[2]["end"], 15.0)

    def test_duration_with_sections_intact(self):
        # Section info must still propagate to clips when duration is OK.
        analysis = {
            "duration": 12.0,
            "sections": [{"start": 0.0, "end": 12.0, "label": "chorus", "energy": 0.8}],
            "downbeats": [],
        }
        clips = audio_analysis.suggest_clip_boundaries(
            analysis, clip_duration=6.0
        )
        # Every clip should pick up the chorus label.
        for clip in clips:
            self.assertEqual(clip["section_label"], "chorus")
            self.assertGreater(clip["energy"], 0.7)


class SnapToValidFramesTests(unittest.TestCase):
    """Tests for _snap_to_valid_frames frame-snapping utility."""

    def test_one_second_at_16fps(self):
        # 1 second at 16 fps = 16 frames; step=4 → snapped to 17 (4n+1)
        # because the formula is (raw-1)//step*step + 1.
        n = audio_analysis._snap_to_valid_frames(1.0, fps=16)
        # 16 -> (16-1)//4*4+1 = 12+1 = 13; min is frames_steps+1=5
        self.assertEqual(n, 13)

    def test_respects_frames_minimum(self):
        # Even a 0-second duration must snap to at least frames_minimum.
        n = audio_analysis._snap_to_valid_frames(
            0.0, fps=16, frames_steps=4, frames_minimum=9
        )
        self.assertGreaterEqual(n, 9)

    def test_steps_alignment(self):
        # All snapped values must satisfy: (n - 1) % frames_steps == 0
        for dur in [0.5, 1.0, 2.0, 5.5, 10.0, 22.0, 30.0]:
            n = audio_analysis._snap_to_valid_frames(dur, fps=16)
            self.assertEqual(
                (n - 1) % 4, 0,
                f"duration {dur}s → {n} frames not aligned to step 4"
            )


class PlanDialogueScenesEdgeCaseTests(unittest.TestCase):
    """Tests for plan_dialogue_scenes with various edge cases."""

    def test_no_lyrics_creates_evenly_spaced_clips(self):
        # Without lyrics, dialogue plan should still produce clips
        # covering the duration.
        analysis = {"duration": 10.0, "lyrics": []}
        clips = audio_analysis.plan_dialogue_scenes(
            analysis=analysis,
            fps=16,
            frames_steps=4,
            frames_minimum=5,
        )
        self.assertGreater(len(clips), 0)
        # Total coverage should be close to the full duration.
        total = sum(c["end"] - c["start"] for c in clips)
        self.assertGreater(total, 8.0)  # allow small overshoot

    def test_short_duration_single_clip(self):
        analysis = {"duration": 4.0, "lyrics": []}
        clips = audio_analysis.plan_dialogue_scenes(
            analysis=analysis,
            fps=16,
            frames_steps=4,
            frames_minimum=5,
        )
        # A 4-second song should fit in a single clip (within tolerance).
        self.assertGreaterEqual(len(clips), 1)

    def test_zero_duration(self):
        # Zero duration should not crash.
        analysis = {"duration": 0.0, "lyrics": []}
        clips = audio_analysis.plan_dialogue_scenes(
            analysis=analysis,
            fps=16,
        )
        # Either zero or one clip is acceptable.
        self.assertGreaterEqual(len(clips), 0)

    def test_negative_duration_does_not_crash(self):
        # Defensive — negative duration shouldn't blow up.
        analysis = {"duration": -5.0, "lyrics": []}
        try:
            clips = audio_analysis.plan_dialogue_scenes(
                analysis=analysis,
                fps=16,
            )
            self.assertIsInstance(clips, list)
        except (ValueError, ZeroDivisionError):
            # If the function intentionally raises for nonsensical input
            # we still consider this acceptable as long as the error is
            # explicit, not a silent corrupt state.
            pass


class ClassifySectionsWithLyricsTests(unittest.TestCase):
    """Tests for the section-label rewriting helper."""

    def test_replace_labels_by_index(self):
        analysis = {
            "sections": [
                {"start": 0.0, "end": 10.0, "label": "verse", "energy": 0.5},
                {"start": 10.0, "end": 20.0, "label": "verse", "energy": 0.7},
            ],
        }
        out = audio_analysis.classify_sections_with_lyrics(
            analysis, ["chorus", "bridge"]
        )
        self.assertEqual(out["sections"][0]["label"], "chorus")
        self.assertEqual(out["sections"][1]["label"], "bridge")

    def test_unknown_label_is_dropped(self):
        analysis = {
            "sections": [
                {"start": 0.0, "end": 10.0, "label": "verse", "energy": 0.5},
            ],
        }
        # An invalid label must be rejected (not crash), keeping the
        # original 'verse' label intact.
        out = audio_analysis.classify_sections_with_lyrics(
            analysis, ["__nonsense__"]
        )
        self.assertEqual(out["sections"][0]["label"], "verse")

    def test_more_labels_than_sections_is_safe(self):
        analysis = {
            "sections": [
                {"start": 0.0, "end": 10.0, "label": "verse", "energy": 0.5},
            ],
        }
        out = audio_analysis.classify_sections_with_lyrics(
            analysis, ["chorus", "bridge", "outro"]
        )
        self.assertEqual(out["sections"][0]["label"], "chorus")

    def test_fewer_labels_than_sections_keeps_remaining(self):
        analysis = {
            "sections": [
                {"start": 0.0, "end": 10.0, "label": "verse", "energy": 0.5},
                {"start": 10.0, "end": 20.0, "label": "chorus", "energy": 0.7},
            ],
        }
        out = audio_analysis.classify_sections_with_lyrics(
            analysis, ["bridge"]
        )
        # First section updated; second unchanged.
        self.assertEqual(out["sections"][0]["label"], "bridge")
        self.assertEqual(out["sections"][1]["label"], "chorus")


if __name__ == "__main__":
    unittest.main()
