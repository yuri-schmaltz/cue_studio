"""Shared clip-length arithmetic for Director's per-shot render plan.

Director turns a planned shot into a frame count twice: once in the
render pipeline, and once in the pre-flight estimator that tells the user
how long a project will take before any GPU time is spent.  When the two
disagree, the estimate describes a render that never happens.

The two rules that decide a shot's length therefore live here, once:

``standard_clip_frame_count``
    **Seconds are the fps-agnostic ground truth.**  A planned shot carries
    ``start``/``end`` (and sometimes ``duration_sec``).  Converting at the
    *target model's* fps is what keeps a 26 s music-video shot from
    silently becoming 16.6 s — the bug that shipped when Director trusted
    a ``duration_frames`` value computed at the Studio model's fps.

``quantize_clip_frame_schedule``
    A model's frame lattice is ``latent * n + 1``.  Snapping every shot
    independently compounds the error (up to ``latent - 1`` frames per
    shot), so the rounding residual is carried into the next shot and
    every cumulative cut stays within half a latent step of the plan.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Optional, Sequence

# Director's generic fallback for a shot with no measurable length.
DEFAULT_FALLBACK_SECONDS = 20.0


def _positive_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return default
    return parsed


def clip_duration_seconds(
    planned_clip: Mapping[str, Any] | None,
    *,
    fallback_seconds: float = DEFAULT_FALLBACK_SECONDS,
) -> float:
    """Return the wall-clock length of one planned shot, in seconds."""

    clip = planned_clip if isinstance(planned_clip, Mapping) else {}
    duration = _positive_float(clip.get("duration_sec"))
    if duration > 0:
        return duration
    start = _positive_float(clip.get("start"))
    end = _positive_float(clip.get("end"))
    if end > start:
        return end - start
    return max(0.0, float(fallback_seconds))


def standard_clip_frame_count(
    planned_clip: Mapping[str, Any] | None,
    *,
    fps: float,
    min_clip_frames: int,
    fallback_seconds: float = DEFAULT_FALLBACK_SECONDS,
    fallback_frames: Optional[int] = None,
) -> int:
    """Frames needed to render one planned shot.

    ``min_clip_frames`` is the model's native minimum, not an artificial
    duration floor. ``fallback_frames`` mirrors the pipeline's habit of
    reusing a planner-provided frame count when the shot has no duration
    at all; it is only consulted for degenerate zero-length shots.
    """

    clip = planned_clip if isinstance(planned_clip, Mapping) else {}
    duration = _positive_float(clip.get("duration_sec"))
    if duration <= 0:
        start = _positive_float(clip.get("start"))
        end = _positive_float(clip.get("end"))
        duration = end - start
    if duration > 0:
        frames = int(round(duration * max(1.0, _positive_float(fps, 25.0))))
    else:
        frames = None
        if fallback_frames is not None:
            try:
                frames = int(fallback_frames)
            except (TypeError, ValueError):
                frames = None
        if frames is None:
            frames = int(round(max(0.0, float(fallback_seconds)) * max(1.0, _positive_float(fps, 25.0))))
    return max(frames, int(min_clip_frames))


def standard_clip_frame_schedule(
    planned_clips: Iterable[Mapping[str, Any] | None],
    *,
    fps: float,
    min_clip_frames: int,
    fallback_seconds: float = DEFAULT_FALLBACK_SECONDS,
    fallback_frames: Optional[Sequence[int]] = None,
) -> list[int]:
    """Frame count for every planned shot, in plan order."""

    frames: list[int] = []
    for index, clip in enumerate(planned_clips or []):
        clip_fallback = None
        if fallback_frames is not None and index < len(fallback_frames):
            clip_fallback = fallback_frames[index]
        frames.append(
            standard_clip_frame_count(
                clip,
                fps=fps,
                min_clip_frames=min_clip_frames,
                fallback_seconds=fallback_seconds,
                fallback_frames=clip_fallback,
            )
        )
    return frames


def quantize_clip_frame_schedule(
    requested_frames: Sequence[float],
    min_frames: int,
    latent_size: int,
) -> list[int]:
    """Match Director's carried rounding for a sequence of clip lengths.

    Every clip lands on the model's ``latent * n + 1`` lattice, and the
    residual of one clip is carried into the next so the cumulative
    timeline never drifts away from the planned cut points.
    """

    latent_size = max(1, int(latent_size or 1))
    min_frames = max(1, int(min_frames or 1))
    carried: list[int] = []
    carry = 0.0
    for frame_count in requested_frames:
        target = float(frame_count) + carry
        quantized = max(
            round((target - 1) / latent_size) * latent_size + 1,
            min_frames,
        )
        carry = target - quantized
        carried.append(int(quantized))
    return carried


__all__ = [
    "DEFAULT_FALLBACK_SECONDS",
    "clip_duration_seconds",
    "quantize_clip_frame_schedule",
    "standard_clip_frame_count",
    "standard_clip_frame_schedule",
]
