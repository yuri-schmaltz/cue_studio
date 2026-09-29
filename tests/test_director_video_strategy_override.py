"""Regression tests for the Director video-strategy override fix.

Bug history (2026-09-29)
------------------------
A user with a saved ``director_max_shot_frames: 5`` override in localStorage
(from a previous model with a published ``frames_maximum``) switched to
LTX2 22B Distilled. The frontend kept sending the override, the backend
rejected with::

    "ltx2_22B_distilled_1_1 does not publish a bounded shot length to override."

— and the frontend never surfaced the error in the toast (the user saw
"Pipeline: Idle" with no feedback). The Director pipeline then crashed
inside the orchestrator with::

    TypeError: unsupported format string passed to NoneType.__format__

Three layered fixes were applied:

1. ``app/services/director_video_strategy.py`` — accept manual overrides
   on rolling-window models (``sliding_window: True``) as per-window
   upper bounds rather than rejecting them. Still validates the frame
   lattice (``frames_minimum`` + ``frames_step``).

2. ``ui/src/stores/useStore.ts`` — don't spread ``undefined`` /
   ``NaN`` into the request body, and drop stale overrides when the
   active model has no published ``frames_maximum``.

3. ``ui/src/components/Sidebar/DirectorChat.tsx`` — when the model uses
   sliding windows, hide the dropdown but show a hint explaining why.

These tests exercise the backend fix end-to-end with mock model_defs.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ROOT = REPO_ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))


class OverrideAcceptanceTests(unittest.TestCase):
    """``build_director_video_execution_profile`` accepts overrides on
    sliding-window models that lack a published ``frames_maximum``."""

    def _profile(
        self,
        *,
        model_type: str = "ltx2_22B_distilled_1_1",
        manual_max_frames: Any = None,
        frames_maximum: Any = None,
        frames_minimum: int = 17,
        frames_steps: int = 8,
        sliding_window: bool = True,
        fps: float = 24.0,
    ) -> dict[str, Any]:
        from services.director_video_strategy import (
            build_director_video_execution_profile,
        )
        model_def: dict[str, Any] = {
            "frames_minimum": frames_minimum,
            "frames_steps": frames_steps,
            "fps": fps,
            "sliding_window": sliding_window,
        }
        if frames_maximum is not None:
            model_def["frames_maximum"] = frames_maximum
        return build_director_video_execution_profile(
            model_type=model_type,
            model_def=model_def,
            video_params={},
            hardware={"gpu_vram_gb": 12.0},
            manual_max_frames=manual_max_frames,
        )

    def test_rolling_window_model_accepts_override(self):
        # LTX2 doesn't publish frames_maximum but has sliding_window=True.
        # A user's saved override that's on the lattice (>= frames_minimum,
        # step frames_steps) is accepted as a per-window upper bound.
        profile = self._profile(
            frames_maximum=None,
            sliding_window=True,
            manual_max_frames=25,  # 17 + 1*8 = 25, on lattice
        )
        self.assertEqual(profile["manual_override"], True)
        self.assertEqual(profile["manual_max_frames"], 25)
        self.assertTrue(profile["rolling_window_override"])
        self.assertEqual(profile["effective_max_frames"], 25)

    def test_rolling_window_model_omitted_override_uses_recommended(self):
        # When no override is supplied on a sliding-window model with no
        # architectural_maximum, recommended_maximum stays None and
        # effective_max_frames is whatever the recommendation/profile says
        # (currently also None for LTX2 — the runtime picks the window
        # size from the canvas + GPU on its own).
        profile = self._profile(
            frames_maximum=None,
            sliding_window=True,
            manual_max_frames=None,
        )
        self.assertEqual(profile["manual_override"], False)
        self.assertIsNone(profile["manual_max_frames"])
        self.assertFalse(profile["rolling_window_override"])

    def test_fixed_shot_model_without_maximum_still_rejects(self):
        # Models that lack BOTH frames_maximum and sliding_window remain
        # rejected — there's no way to honor an override at all.
        from services.director_video_strategy import (
            build_director_video_execution_profile,
        )
        with self.assertRaises(ValueError) as ctx:
            build_director_video_execution_profile(
                model_type="legacy_fixed_shot",
                model_def={
                    "frames_minimum": 16,
                    "frames_steps": 8,
                    "fps": 24,
                    # no sliding_window, no frames_maximum
                },
                video_params={},
                hardware={"gpu_vram_gb": 12.0},
                manual_max_frames=16,
            )
        self.assertIn("does not publish", str(ctx.exception))

    def test_model_with_maximum_clamps_override(self):
        # When frames_maximum IS published (e.g. MiniMax H3), the override
        # is clamped to that ceiling so a user-set value from another
        # model can't exceed it.
        profile = self._profile(
            model_type="minimax_h3_ref2va_distilled",
            frames_maximum=345,
            frames_minimum=17,
            frames_steps=8,
            sliding_window=False,
            fps=24,
            manual_max_frames=9999,
        )
        self.assertEqual(profile["manual_override"], True)
        self.assertEqual(profile["manual_max_frames"], 345)
        self.assertEqual(profile["effective_max_frames"], 345)
        self.assertFalse(profile["rolling_window_override"])

    def test_override_below_minimum_rejected(self):
        # Override below frames_minimum or off the lattice must be rejected
        # with a helpful error — even on sliding-window models.
        from services.director_video_strategy import (
            build_director_video_execution_profile,
        )
        with self.assertRaises(ValueError) as ctx:
            build_director_video_execution_profile(
                model_type="ltx2_22B_distilled_1_1",
                model_def={
                    "frames_minimum": 17,
                    "frames_steps": 8,
                    "fps": 24,
                    "sliding_window": True,
                },
                video_params={},
                hardware={"gpu_vram_gb": 12.0},
                manual_max_frames=9,  # below minimum 17
            )
        self.assertIn("frame lattice", str(ctx.exception))

    def test_override_off_lattice_rejected(self):
        # 25 is on the [17, 25, 33, ...] lattice (step 8), but 27 isn't.
        from services.director_video_strategy import (
            build_director_video_execution_profile,
        )
        with self.assertRaises(ValueError) as ctx:
            build_director_video_execution_profile(
                model_type="ltx2_22B_distilled_1_1",
                model_def={
                    "frames_minimum": 17,
                    "frames_steps": 8,
                    "fps": 24,
                    "sliding_window": True,
                },
                video_params={},
                hardware={"gpu_vram_gb": 12.0},
                manual_max_frames=27,
            )
        self.assertIn("frame lattice", str(ctx.exception))

    def test_override_string_zero_treated_as_none(self):
        # The frontend sometimes serializes "" or "0" when the user
        # picks "Auto" from the dropdown. The backend treats these as
        # no-override, not as a real frame count.
        for value in ("", "0", 0):
            profile = self._profile(
                frames_maximum=None,
                sliding_window=True,
                manual_max_frames=value,
            )
            self.assertEqual(
                profile["manual_override"], False,
                f"Value {value!r} should be treated as no override",
            )


class FixedShotPathCoverage(unittest.TestCase):
    """Defensive coverage for the path that still rejects fixed-shot
    models.  Makes the new accept-when-sliding-window contract explicit."""

    def test_sliding_window_flag_consulted(self):
        # Sanity check: ``build_director_video_execution_profile`` actually
        # reads ``sliding_window`` from the model_def. If a future refactor
        # renames the flag without updating the strategy, this test will
        # catch it before users hit the bug again.
        from services.director_video_strategy import (
            build_director_video_execution_profile,
        )
        # With sliding_window=True: accept 25 (on lattice).
        with_sliding = build_director_video_execution_profile(
            model_type="test_with_sliding",
            model_def={
                "frames_minimum": 17,
                "frames_steps": 8,
                "fps": 24,
                "sliding_window": True,
            },
            video_params={},
            hardware={"gpu_vram_gb": 12.0},
            manual_max_frames=25,
        )
        self.assertTrue(with_sliding["manual_override"])
        self.assertTrue(with_sliding["rolling_window_override"])
        # Without sliding_window AND no frames_maximum: still rejects —
        # that's the legacy "fixed-shot model without bound" path.
        with self.assertRaises(ValueError) as ctx:
            build_director_video_execution_profile(
                model_type="test_without_sliding",
                model_def={
                    "frames_minimum": 17,
                    "frames_steps": 8,
                    "fps": 24,
                    "sliding_window": False,
                },
                video_params={},
                hardware={"gpu_vram_gb": 12.0},
                manual_max_frames=25,
            )
        self.assertIn("does not publish", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()