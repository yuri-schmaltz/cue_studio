"""Tests for the Director pre-flight estimator and its endpoint.

The pre-flight is what tells a Director user how many shots their plan
becomes, how long the render will take and whether the longest shot fits
in this machine's VRAM — before any GPU time is spent. These tests pin
the arithmetic that decides those answers.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))


def run(coro):
    return asyncio.run(coro)


def _fake_request(body: Any) -> mock.MagicMock:
    request = mock.MagicMock()
    request.json = mock.AsyncMock(return_value=body)
    request.headers = mock.MagicMock()
    request.headers.get = mock.MagicMock(return_value="application/json")
    return request


def _music_video_clips(count: int = 13, total: float = 255.0) -> list[dict[str, Any]]:
    """The shape of a 4:15 track split into even shots."""

    clips: list[dict[str, Any]] = []
    for index in range(count):
        start = total * index / count
        end = total * (index + 1) / count
        clips.append({"start": round(start, 3), "end": round(end, 3)})
    return clips


class ClipScheduleTests(unittest.TestCase):
    def test_seconds_are_the_ground_truth(self) -> None:
        from services.director.clip_schedule import standard_clip_frame_count

        # A 26 s shot at LTX-2's 25 fps is 650 frames — not 416, which is
        # what the Studio model's 16 fps produced.
        frames = standard_clip_frame_count(
            {"start": 0, "end": 26},
            fps=25,
            min_clip_frames=125,
        )
        self.assertEqual(frames, 650)

    def test_duration_sec_wins_over_start_end(self) -> None:
        from services.director.clip_schedule import standard_clip_frame_count

        frames = standard_clip_frame_count(
            {"start": 0, "end": 10, "duration_sec": 4},
            fps=25,
            min_clip_frames=1,
        )
        self.assertEqual(frames, 100)

    def test_minimum_floor_is_respected(self) -> None:
        from services.director.clip_schedule import standard_clip_frame_count

        frames = standard_clip_frame_count(
            {"start": 0, "end": 0.1},
            fps=25,
            min_clip_frames=125,
        )
        self.assertEqual(frames, 125)

    def test_carried_quantization_keeps_the_total(self) -> None:
        from services.director.clip_schedule import quantize_clip_frame_schedule

        quantized = quantize_clip_frame_schedule([525, 525, 525], 17, 8)
        self.assertTrue(all((frames - 1) % 8 == 0 for frames in quantized))
        # The rounding residual is carried, so the whole sequence stays
        # within a single latent step of the planned cut points instead of
        # drifting three residuals away from them.
        self.assertLess(abs(sum(quantized) - 3 * 525), 8)

    def test_quantization_is_idempotent(self) -> None:
        from services.director.clip_schedule import quantize_clip_frame_schedule

        once = quantize_clip_frame_schedule([525, 525], 17, 8)
        twice = quantize_clip_frame_schedule(once, 17, 8)
        self.assertEqual(once, twice)


class PreflightReportTests(unittest.TestCase):
    def test_reports_clip_count_and_duration(self) -> None:
        from services.director.preflight import build_preflight_report

        report = build_preflight_report(
            planned_clips=_music_video_clips(),
            video_model="ltx2_22B_distilled_1_1",
            resolution="1280x720",
            num_inference_steps=8,
            fps=25,
            frames_minimum=17,
            latent_size=8,
        )
        self.assertEqual(report["clip_count"], 13)
        self.assertAlmostEqual(report["total_duration_seconds"], 255.0, places=1)
        self.assertGreater(report["total_frames"], 0)
        self.assertEqual(len(report["per_clip"]), 13)

    def test_no_history_means_no_estimate_and_a_warning(self) -> None:
        from services.director.preflight import build_preflight_report

        report = build_preflight_report(
            planned_clips=_music_video_clips(),
            video_model="ltx2_22B_distilled_1_1",
            resolution="1280x720",
            fps=25,
            frames_minimum=17,
            latent_size=8,
            eta_history=None,
        )
        self.assertIsNone(report["estimated_seconds"])
        self.assertEqual(report["eta_confidence"], "calibrating")
        codes = {warning["code"] for warning in report["warnings"]}
        self.assertIn("no_eta_history", codes)

    def test_estimate_scales_with_the_plan(self) -> None:
        from services.director.preflight import build_preflight_report

        history = _StubHistory(active_seconds=100.0, match="family", samples=8)
        short = build_preflight_report(
            planned_clips=_music_video_clips(count=2, total=20.0),
            video_model="ltx2_22B_distilled_1_1",
            resolution="1280x720",
            fps=25,
            frames_minimum=17,
            latent_size=8,
            eta_history=history,
        )
        long = build_preflight_report(
            planned_clips=_music_video_clips(count=13, total=255.0),
            video_model="ltx2_22B_distilled_1_1",
            resolution="1280x720",
            fps=25,
            frames_minimum=17,
            latent_size=8,
            eta_history=history,
        )
        self.assertIsNotNone(short["estimated_seconds"])
        self.assertIsNotNone(long["estimated_seconds"])
        self.assertGreater(long["estimated_seconds"], short["estimated_seconds"])
        self.assertEqual(long["eta_match"], "family")
        self.assertEqual(long["eta_confidence"], "medium")

    def test_long_render_is_flagged(self) -> None:
        from services.director.preflight import build_preflight_report

        history = _StubHistory(active_seconds=4000.0, match="family", samples=8)
        report = build_preflight_report(
            planned_clips=_music_video_clips(),
            video_model="ltx2_22B_distilled_1_1",
            resolution="1280x720",
            fps=25,
            frames_minimum=17,
            latent_size=8,
            eta_history=history,
        )
        codes = {warning["code"] for warning in report["warnings"]}
        self.assertIn("long_render", codes)

    def test_memory_policy_decides_the_vram_ceiling(self) -> None:
        from services.director.preflight import build_preflight_report

        policy = {
            "resolution_bands": [
                {
                    "min_pixels": 0,
                    "vram_tiers": [
                        {"max_vram_gb": 8, "frames": 124},
                        {"max_vram_gb": 16, "frames": 243},
                        {"frames": 345},
                    ],
                }
            ]
        }
        report = build_preflight_report(
            planned_clips=[{"start": 0, "end": 4}],
            video_model="minimax_h3",
            resolution="1280x720",
            fps=25,
            frames_minimum=17,
            latent_size=8,
            hardware={"gpu_vram_gb": 12},
            memory_policy=policy,
        )
        # 4 s at 25 fps is 100 frames, which the 12 GB tier (243) holds.
        self.assertEqual(report["max_frames_at_detected_vram"], 243)
        self.assertEqual(report["oom_risk"], "low")
        self.assertEqual(report["vram_required_gb"], 8)

    def test_shot_over_the_policy_limit_is_an_error(self) -> None:
        from services.director.preflight import build_preflight_report

        policy = {
            "resolution_bands": [
                {
                    "min_pixels": 0,
                    "vram_tiers": [
                        {"max_vram_gb": 8, "frames": 124},
                        {"frames": 345},
                    ],
                }
            ]
        }
        report = build_preflight_report(
            planned_clips=[{"start": 0, "end": 30}],
            video_model="minimax_h3",
            resolution="1280x720",
            fps=25,
            frames_minimum=17,
            latent_size=8,
            hardware={"gpu_vram_gb": 8},
            memory_policy=policy,
            model_def={"director_video_strategy": "bounded_start_end"},
        )
        self.assertEqual(report["oom_risk"], "high")
        severities = {
            warning["code"]: warning["severity"] for warning in report["warnings"]
        }
        self.assertEqual(severities.get("oom_risk"), "error")

    def test_execution_profile_error_is_surfaced(self) -> None:
        from services.director.preflight import build_preflight_report

        report = build_preflight_report(
            planned_clips=_music_video_clips(count=2, total=20.0),
            video_model="minimax_h3",
            resolution="1920x1088",
            fps=25,
            frames_minimum=17,
            latent_size=8,
            execution_profile_error=(
                "H3 has no automatic one-pass profile for 1920x1088 on this "
                "8 GB GPU. Choose 480p."
            ),
            hardware={"gpu_vram_gb": 8},
        )
        self.assertEqual(report["oom_risk"], "high")
        codes = {warning["code"] for warning in report["warnings"]}
        self.assertIn("oom_risk", codes)

    def test_empty_plan_is_reported_without_crashing(self) -> None:
        from services.director.preflight import build_preflight_report

        report = build_preflight_report(planned_clips=[])
        self.assertEqual(report["clip_count"], 0)
        self.assertIsNone(report["estimated_seconds"])
        codes = {warning["code"] for warning in report["warnings"]}
        self.assertIn("no_clips", codes)


class _StubEstimate:
    def __init__(self, active_seconds: float, match: str, samples: int) -> None:
        self.active_seconds = active_seconds
        self.wall_seconds = active_seconds + 10.0
        self.window_seconds = None
        self.non_step_seconds = None
        self.sample_count = samples
        self.match = match


class _StubHistory:
    """A timing history that always answers with the same numbers."""

    def __init__(self, active_seconds: float, match: str, samples: int) -> None:
        self._active = active_seconds
        self._match = match
        self._samples = samples

    def estimate(self, task: Any) -> _StubEstimate:
        return _StubEstimate(self._active, self._match, self._samples)

    def estimate_model_scoped(self, task: Any, **kwargs: Any) -> _StubEstimate:
        return _StubEstimate(self._active, "model", self._samples)

    def observed_window_frames(self, **kwargs: Any) -> int:
        return 137


class ModelScopedEtaTests(unittest.TestCase):
    """The coarse match is what prices a Director music video."""

    def test_model_scoped_match_uses_the_local_rate(self) -> None:
        from services.generation_eta import GenerationEtaHistory

        with tempfile.TemporaryDirectory() as folder:
            history = GenerationEtaHistory(
                str(Path(folder) / "eta.sqlite3"),
                hardware={"gpu_name": "test-gpu", "gpu_vram_gb": 24},
            )
            task = {
                "params": {
                    "model_type": "ltx2_22b_distilled_1_1",
                    "resolution": "1280x720",
                    "num_inference_steps": 8,
                    "video_length": 137,
                    "fps": 25,
                }
            }
            history.record(task, 200.0, wall_seconds=240.0, source_key="a")

            # A Director music video carries an audio guide, so its family
            # key never matches a plain shot — but the rate still applies.
            director_task = {
                "params": {
                    "model_type": "ltx2_22b_distilled_1_1",
                    "resolution": "1280x720",
                    "num_inference_steps": 8,
                    "video_length": 137,
                    "fps": 25,
                    "image_start": "preflight://shot-start",
                    "audio_guide": "preflight://audio",
                }
            }
            self.assertIsNone(history.estimate(director_task))
            coarse = history.estimate_model_scoped(director_task)
            self.assertIsNotNone(coarse)
            self.assertEqual(coarse.match, "model")
            self.assertAlmostEqual(coarse.active_seconds, 200.0, delta=1.0)

    def test_observed_window_frames_reports_the_widest_pass(self) -> None:
        from services.generation_eta import GenerationEtaHistory

        with tempfile.TemporaryDirectory() as folder:
            history = GenerationEtaHistory(
                str(Path(folder) / "eta.sqlite3"),
                hardware={"gpu_name": "test-gpu", "gpu_vram_gb": 24},
            )
            for index, frames in enumerate((97, 137, 121)):
                history.record(
                    {
                        "params": {
                            "model_type": "ltx2_22b_distilled_1_1",
                            "resolution": "1280x720",
                            "num_inference_steps": 8,
                            "video_length": frames,
                            "fps": 25,
                        }
                    },
                    100.0,
                    source_key=f"clip-{index}",
                )
            widest = history.observed_window_frames(
                model_type="ltx2_22b_distilled_1_1",
                resolution="1280x720",
            )
            self.assertEqual(widest, 137)
            self.assertIsNone(
                history.observed_window_frames(
                    model_type="some_other_model",
                    resolution="1280x720",
                )
            )


class PreflightRouterTests(unittest.TestCase):
    def _deps(self, **overrides: Any):
        from services.director.http_preflight import DirectorPreflightDeps

        defaults: dict[str, Any] = {
            "hardware": lambda: {"gpu_name": "test-gpu", "gpu_vram_gb": 24},
            "eta_history": lambda: _StubHistory(120.0, "family", 6),
            "model_def": lambda model_type: {
                "fps": 25,
                "frames_minimum": 17,
                "frames_steps": 8,
                "sliding_window": True,
            },
            "model_geometry": lambda model_type: (17, 8, 8),
            "default_settings": lambda model_type: {"sliding_window_size": 241},
        }
        defaults.update(overrides)
        return DirectorPreflightDeps(**defaults)

    def test_endpoint_returns_a_report(self) -> None:
        from services.director.http_preflight import build_preflight_router

        router = build_preflight_router(self._deps())
        handler = router.routes[0].endpoint
        report = run(
            handler(
                _fake_request(
                    {
                        "video_model": "ltx2_22B_distilled_1_1",
                        "planned_clips": _music_video_clips(count=4, total=60.0),
                        "resolution": "1280x720",
                        "num_inference_steps": 8,
                        "has_audio_guide": True,
                        "has_start_images": True,
                    }
                )
            )
        )
        self.assertEqual(report["clip_count"], 4)
        self.assertIsNotNone(report["estimated_seconds"])
        self.assertEqual(report["eta_match"], "family")

    def test_endpoint_rejects_a_body_without_a_model(self) -> None:
        from fastapi import HTTPException

        from services.director.http_preflight import build_preflight_router

        router = build_preflight_router(self._deps())
        handler = router.routes[0].endpoint
        with self.assertRaises(HTTPException) as caught:
            run(handler(_fake_request({"planned_clips": []})))
        self.assertEqual(caught.exception.status_code, 400)

    def test_endpoint_survives_a_broken_history(self) -> None:
        from services.director.http_preflight import build_preflight_router

        class _Broken:
            def estimate(self, task: Any) -> Any:
                raise RuntimeError("history is broken")

            def estimate_model_scoped(self, task: Any, **kwargs: Any) -> Any:
                raise RuntimeError("history is broken")

            def observed_window_frames(self, **kwargs: Any) -> Any:
                raise RuntimeError("history is broken")

        router = build_preflight_router(self._deps(eta_history=lambda: _Broken()))
        handler = router.routes[0].endpoint
        report = run(
            handler(
                _fake_request(
                    {
                        "video_model": "ltx2_22B_distilled_1_1",
                        "planned_clips": _music_video_clips(count=2, total=20.0),
                        "resolution": "1280x720",
                    }
                )
            )
        )
        self.assertIsNone(report["estimated_seconds"])
        self.assertEqual(report["clip_count"], 2)


if __name__ == "__main__":
    unittest.main()
