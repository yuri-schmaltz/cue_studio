"""Tests for the script-driven clip structure.

The Director used to plan every cut from the audio alone. A time-anchored
briefing could only decorate that plan. These tests cover the planner that
turns the briefing's own timecodes into the cut points, plus the
``section_label``/``label`` mismatch that made every clip look like a verse.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from services.director.scene_script import parse_scene_script  # noqa: E402
from services.director.script_structure import (  # noqa: E402
    GRANULARITY_BEAT,
    GRANULARITY_SCENE,
    plan_script_clip_structure,
)


def _analysis(duration: float = 60.0, bpm: float = 120.0) -> dict:
    """A minimal analysis dict with one section and a steady beat grid."""
    return {
        "bpm": bpm,
        "duration": duration,
        "beats": [{"time": i * 0.5} for i in range(int(duration * 2) + 1)],
        "sections": [
            {"start": 0.0, "end": duration, "label": "chorus", "energy": 0.8},
        ],
        "lyrics": [
            {"start": 0.0, "end": 10.0, "speaker": "gary", "text": "a"},
            {"start": 10.0, "end": 20.0, "speaker": "nuno", "text": "b"},
        ],
    }


class ScriptStructureTests(unittest.TestCase):
    """The briefing's timecodes decide the cut points."""

    def test_scene_granularity_yields_one_clip_per_scene(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:20)\n"
            "CENA 2: B (0:20 - 0:40)\n"
            "CENA 3: C (0:40 - 0:60)\n"
        )
        clips = plan_script_clip_structure(
            script, _analysis(60.0), granularity=GRANULARITY_SCENE, fps=25
        )
        self.assertEqual(len(clips), 3)
        self.assertAlmostEqual(clips[0]["start"], 0.0, places=3)
        self.assertAlmostEqual(clips[0]["end"], 20.0, places=3)
        self.assertAlmostEqual(clips[2]["end"], 60.0, places=3)

    def test_beat_granularity_yields_one_clip_per_sub_segment(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:30)\n"
            "0:00 - 0:10: primeiro\n"
            "0:10 - 0:20: segundo\n"
            "0:20 - 0:30: terceiro\n"
        )
        clips = plan_script_clip_structure(
            script, _analysis(30.0), granularity=GRANULARITY_BEAT, fps=25
        )
        self.assertEqual(len(clips), 3)
        self.assertAlmostEqual(clips[0]["end"], 10.0, places=3)
        self.assertAlmostEqual(clips[1]["start"], 10.0, places=3)
        self.assertAlmostEqual(clips[2]["end"], 30.0, places=3)

    def test_beat_granularity_yields_more_shots_than_scene_granularity(self):
        """The music-video rhythm: more sub-segments means more shots."""
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:25)\n"
            "0:00 - 0:08: a\n"
            "0:08 - 0:16: b\n"
            "0:16 - 0:25: c\n"
            "CENA 2: B (0:25 - 0:50)\n"
            "0:25 - 0:37: d\n"
            "0:37 - 0:50: e\n"
        )
        scenes = plan_script_clip_structure(
            script, _analysis(50.0), granularity=GRANULARITY_SCENE, fps=25
        )
        beats = plan_script_clip_structure(
            script, _analysis(50.0), granularity=GRANULARITY_BEAT, fps=25
        )
        self.assertEqual(len(scenes), 2)
        self.assertEqual(len(beats), 5)
        self.assertGreater(len(beats), len(scenes))

    def test_script_without_timecodes_plans_nothing(self):
        script = parse_scene_script("Uma cena sem tempo.\n")
        self.assertEqual(
            plan_script_clip_structure(script, _analysis(), granularity=GRANULARITY_SCENE),
            [],
        )

    def test_empty_script_plans_nothing(self):
        self.assertEqual(plan_script_clip_structure({}, _analysis()), [])

    def test_clips_are_annotated_from_the_audio(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:20)\n")
        clips = plan_script_clip_structure(
            script, _analysis(60.0), granularity=GRANULARITY_SCENE, fps=25
        )
        clip = clips[0]
        self.assertEqual(clip["section_label"], "chorus")
        self.assertAlmostEqual(clip["energy"], 0.8, places=3)
        self.assertGreater(clip["beat_count"], 0)
        self.assertGreater(clip["duration_frames"], 0)
        # The dominant speaker comes from the lyrics overlapping the cut.
        self.assertEqual(clip["dominant_speaker"], "gary")

    def test_dominant_speaker_follows_the_cut(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:15)\n"
            "CENA 2: B (0:15 - 0:30)\n"
        )
        clips = plan_script_clip_structure(
            script, _analysis(60.0), granularity=GRANULARITY_SCENE, fps=25
        )
        self.assertEqual(clips[0]["dominant_speaker"], "gary")
        self.assertEqual(clips[1]["dominant_speaker"], "nuno")

    def test_clips_are_sorted_and_contiguous_within_the_script(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:20)\n"
            "CENA 2: B (0:20 - 0:40)\n"
        )
        clips = plan_script_clip_structure(
            script, _analysis(60.0), granularity=GRANULARITY_SCENE, fps=25
        )
        for previous, current in zip(clips, clips[1:]):
            self.assertLessEqual(previous["end"], current["start"] + 1e-6)
            self.assertGreater(current["start"], previous["start"])

    def test_uncovered_audio_is_filled_with_audio_driven_clips(self):
        """A script covering only part of the track leaves no hole."""
        script = parse_scene_script("CENA 1: A (0:00 - 0:20)\n")
        clips = plan_script_clip_structure(
            script, _analysis(60.0), granularity=GRANULARITY_SCENE, fps=25
        )
        self.assertGreater(len(clips), 1)
        self.assertAlmostEqual(clips[0]["start"], 0.0, places=3)
        self.assertAlmostEqual(clips[-1]["end"], 60.0, places=3)

    def test_window_restricts_the_plan(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:20)\n"
            "CENA 2: B (0:20 - 0:40)\n"
            "CENA 3: C (0:40 - 0:60)\n"
        )
        clips = plan_script_clip_structure(
            script,
            _analysis(60.0),
            granularity=GRANULARITY_SCENE,
            fps=25,
            window_start=20.0,
            window_end=40.0,
        )
        self.assertTrue(clips)
        self.assertGreaterEqual(clips[0]["start"], 20.0 - 1e-6)
        self.assertLessEqual(clips[-1]["end"], 40.0 + 1e-6)

    def test_window_never_exceeds_the_analysed_duration(self):
        script = parse_scene_script("CENA 1: A (0:00 - 10:00)\n")
        clips = plan_script_clip_structure(
            script,
            _analysis(30.0),
            granularity=GRANULARITY_SCENE,
            fps=25,
            total_duration=30.0,
        )
        self.assertTrue(clips)
        self.assertLessEqual(clips[-1]["end"], 30.0 + 1e-6)

    def test_empty_window_plans_nothing(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:20)\n")
        self.assertEqual(
            plan_script_clip_structure(
                script,
                _analysis(60.0),
                window_start=30.0,
                window_end=30.0,
            ),
            [],
        )

    def test_inverted_window_plans_nothing(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:20)\n")
        self.assertEqual(
            plan_script_clip_structure(
                script,
                _analysis(60.0),
                window_start=40.0,
                window_end=10.0,
            ),
            [],
        )

    def test_scene_longer_than_the_model_window_is_split(self):
        """A 60-second scene cannot be one shot on a 26s model."""
        script = parse_scene_script("CENA 1: Longa (0:00 - 1:00)\n")
        clips = plan_script_clip_structure(
            script, _analysis(60.0), granularity=GRANULARITY_SCENE, fps=25
        )
        self.assertGreater(len(clips), 1)
        for clip in clips:
            self.assertLessEqual(clip["end"] - clip["start"], 26.0 + 1e-6)

    def test_long_scene_splits_balanced_rather_than_leaving_a_runt(self):
        """A 27s scene must not become a 26s shot plus a 1s runt."""
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:27)\n"
            "0:00 - 0:13: primeira\n"
            "0:13 - 0:27: segunda\n"
        )
        clips = plan_script_clip_structure(
            script, _analysis(27.0), granularity=GRANULARITY_SCENE, fps=25
        )
        self.assertEqual(len(clips), 2)
        durations = [clip["end"] - clip["start"] for clip in clips]
        for duration in durations:
            self.assertGreater(duration, 5.0)
            self.assertLessEqual(duration, 26.0 + 1e-6)

    def test_long_scene_splits_on_the_authors_own_boundary(self):
        """The cut lands where the script drew it, not on an arbitrary beat."""
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:27)\n"
            "0:00 - 0:13: primeira\n"
            "0:13 - 0:27: segunda\n"
        )
        clips = plan_script_clip_structure(
            script, _analysis(27.0), granularity=GRANULARITY_SCENE, fps=25
        )
        self.assertAlmostEqual(clips[0]["start"], 0.0, places=3)
        self.assertAlmostEqual(clips[0]["end"], 13.0, places=3)
        self.assertAlmostEqual(clips[1]["end"], 27.0, places=3)

    def test_cuts_below_the_model_minimum_are_merged(self):
        """A cut the model cannot render is not a shot."""
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:30)\n"
            "0:00 - 0:01: curtissimo\n"
            "0:01 - 0:15: seguinte\n"
            "0:15 - 0:30: final\n"
        )
        clips = plan_script_clip_structure(
            script,
            _analysis(30.0),
            granularity=GRANULARITY_BEAT,
            fps=25,
            frames_minimum=124,  # 124 frames @ 24fps ≈ 5.2s
        )
        self.assertTrue(clips)
        for clip in clips:
            self.assertGreaterEqual(clip["end"] - clip["start"], 124 / 25 - 1e-6)

    def test_unknown_granularity_falls_back_to_beats(self):
        script = parse_scene_script(
            "CENA 1: A (0:00 - 0:20)\n"
            "0:00 - 0:10: a\n"
            "0:10 - 0:20: b\n"
        )
        clips = plan_script_clip_structure(
            script, _analysis(20.0), granularity="nonsense", fps=25
        )
        self.assertEqual(len(clips), 2)

    def test_accepts_the_dict_form_of_the_script(self):
        script = parse_scene_script("CENA 1: A (0:00 - 0:20)\n")
        clips = plan_script_clip_structure(
            script.to_dict(), _analysis(20.0), granularity=GRANULARITY_SCENE, fps=25
        )
        self.assertEqual(len(clips), 1)

    def test_the_shot_count_is_capped_at_the_editor_limit(self):
        """More scripted moments than the timeline editor accepts."""
        from services.director.script_structure import MAX_SCRIPT_CLIPS

        def timecode(seconds: int) -> str:
            minutes, rest = divmod(seconds, 60)
            return f"{minutes}:{rest:02d}"

        script = parse_scene_script("\n".join(
            f"CENA {index + 1}: X ({timecode(index * 10)} - {timecode((index + 1) * 10)})"
            for index in range(300)
        ))
        clips = plan_script_clip_structure(
            script,
            _analysis(3000.0),
            granularity=GRANULARITY_SCENE,
            fps=25,
            total_duration=3000.0,
        )
        self.assertLessEqual(len(clips), MAX_SCRIPT_CLIPS)
        # The plan still covers the whole track.
        self.assertAlmostEqual(clips[0]["start"], 0.0, places=3)
        self.assertAlmostEqual(clips[-1]["end"], 3000.0, places=3)

    def test_clip_keys_match_the_audio_planner(self):
        """The pipeline consumes both planners' output identically."""
        from services import audio_analysis

        script = parse_scene_script("CENA 1: A (0:00 - 0:20)\n")
        script_clips = plan_script_clip_structure(
            script, _analysis(60.0), granularity=GRANULARITY_SCENE, fps=25
        )
        audio_clips = audio_analysis.plan_clip_structure(
            _analysis(60.0), fps=25, frames_steps=8, frames_minimum=17
        )
        self.assertTrue(script_clips and audio_clips)
        self.assertEqual(
            set(script_clips[0].keys()),
            set(audio_clips[0].keys()),
        )


class SectionLabelTests(unittest.TestCase):
    """The music-video planner must read the section the audio produced."""

    def test_clip_section_reads_section_label(self):
        from services.director.planners.music_video import _clip_section

        self.assertEqual(_clip_section({"section_label": "chorus"}), "chorus")

    def test_clip_section_reads_label(self):
        from services.director.planners.music_video import _clip_section

        self.assertEqual(_clip_section({"label": "intro"}), "intro")

    def test_clip_section_defaults_to_verse(self):
        from services.director.planners.music_video import _clip_section

        self.assertEqual(_clip_section({}), "verse")
        self.assertEqual(_clip_section({"section_label": ""}), "verse")

    def test_audio_planner_output_drives_the_section_strategy(self):
        """A chorus clip must not be planned with the verse framing."""
        from services import audio_analysis
        from services.director.planners.music_video import (
            _SECTION_VISUAL_STRATEGY,
            _clip_section,
        )

        analysis = {
            "bpm": 120.0,
            "duration": 60.0,
            "beats": [{"time": i * 0.5} for i in range(121)],
            "sections": [
                {"start": 0.0, "end": 30.0, "label": "intro", "energy": 0.3},
                {"start": 30.0, "end": 60.0, "label": "chorus", "energy": 0.9},
            ],
            "lyrics": [],
        }
        clips = audio_analysis.plan_clip_structure(analysis, fps=25)
        sections = {_clip_section(clip) for clip in clips}
        self.assertIn("intro", sections)
        self.assertIn("chorus", sections)
        self.assertNotEqual(
            _SECTION_VISUAL_STRATEGY["chorus"]["camera_default"],
            _SECTION_VISUAL_STRATEGY["verse"]["camera_default"],
        )


if __name__ == "__main__":
    unittest.main()
