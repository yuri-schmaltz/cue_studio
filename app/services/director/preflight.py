"""Director pre-flight: what a render will cost, before it costs anything.

Director turns a briefing into a queue of shots and then renders them
one by one.  The user has no way to see the bill until the first shot is
already burning GPU time — and for a 4:15 music video the bill is not
small: the same track that produces twelve satisfying shots can also
produce three hours of compute and a mid-project OOM.

``build_preflight_report`` answers three questions before the queue is
created:

1. **How much?**  Clip count, total duration, total frames and a
   wall-clock estimate derived from the machine's own timing history.
2. **Will it fit?**  The longest shot compared against the model's
   single-pass limit on *this* GPU, using the same execution profile and
   memory policy the pipeline will use.
3. **What should I worry about?**  Concrete warnings, not vague advice.

The service is deliberately free of FastAPI and of model imports so it can
be unit-tested without the engine.  Everything it needs about the world
arrives as an argument.
"""

from __future__ import annotations

import math
import statistics
from typing import Any, Mapping, Optional, Sequence

from ..director_video_strategy import ROLLING_WINDOW, video_strategy
from ..generation_eta import estimate_join_overhead_seconds
from .clip_schedule import (
    clip_duration_seconds,
    quantize_clip_frame_schedule,
    standard_clip_frame_schedule,
)

PREFLIGHT_SCHEMA_VERSION = 1

#: How confident the estimate is, from the strongest to the weakest source.
MATCH_EXACT = "exact"
MATCH_FAMILY = "family"
MATCH_MODEL = "model"
MATCH_NONE = "none"

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"
CONFIDENCE_CALIBRATING = "calibrating"

RISK_LOW = "low"
RISK_MEDIUM = "medium"
RISK_HIGH = "high"
RISK_UNKNOWN = "unknown"

SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_ERROR = "error"

#: The runtime charges roughly this much per clip boundary (queue hand-off,
#: audio slice, progress bookkeeping).  Mirrors the live ETA overhead.
_SECONDS_PER_CLIP_BOUNDARY = 4.0

#: A single shot longer than this needs the rolling-window path.
_ROLLING_WINDOW_SECONDS = 32.0

#: Above this many shots the queue stops being a project and starts being
#: a shift.
_MANY_CLIPS = 20

#: Above this many seconds of estimated render the user should be told.
_LONG_RENDER_SECONDS = 3600.0


def _positive_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(parsed):
        return default
    return parsed


def _positive_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _warning(code: str, severity: str, message: str) -> dict[str, str]:
    return {"code": code, "severity": severity, "message": message}


def _resolution_pixels(resolution: str) -> int:
    text = str(resolution or "").lower().replace("×", "x")
    width = height = 0
    for part in text.split("x"):
        part = part.strip()
        if part.isdigit():
            if not width:
                width = int(part)
            elif not height:
                height = int(part)
    if width and height:
        return width * height
    return 832 * 480


def _synthetic_task(
    index: int,
    *,
    video_model: str,
    resolution: str,
    num_inference_steps: int,
    fps: float,
    frames: int,
    window_frames: Optional[int],
    window_overlap: int,
    has_audio_guide: bool,
    has_start_images: bool,
    has_end_images: bool,
    activated_loras: Sequence[str],
    loras_multipliers: str,
) -> dict[str, Any]:
    """Describe one planned shot the way the queue would describe it.

    The ETA history keys its samples on the shape of the shot: model,
    resolution, step count, conditioning and optimization flags.  Feeding
    the history a synthetic task with the same shape is what lets a plan
    that was never rendered before be priced from shots that were.
    """

    return {
        "index": index,
        "params": {
            "model_type": video_model,
            "resolution": resolution,
            "num_inference_steps": num_inference_steps,
            "video_length": frames,
            "fps": fps,
            "sliding_window_size": max(1, int(window_frames or frames)),
            "sliding_window_overlap": max(0, int(window_overlap or 0)),
            "image_start": "preflight://shot-start" if has_start_images else "",
            "image_end": "preflight://shot-end" if has_end_images else "",
            "audio_guide": "preflight://audio" if has_audio_guide else "",
            "activated_loras": list(activated_loras),
            "loras_multipliers": loras_multipliers,
            # Director renders its shots as one group and joins them at
            # the end; the ETA history prices that join separately.
            "multi_clip_info": {"group_id": "preflight", "index": index},
        },
    }


def _estimate_clip(
    task: Mapping[str, Any],
    *,
    eta_history: Any,
    video_model: str,
    resolution: str,
) -> Any:
    """Price one synthetic shot against the local timing history."""

    if eta_history is None:
        return None
    estimate = None
    getter = getattr(eta_history, "estimate", None)
    if callable(getter):
        try:
            estimate = getter(task)
        except Exception:  # noqa: BLE001 - a broken history must not break the plan
            estimate = None
    if estimate is not None:
        return estimate
    coarse = getattr(eta_history, "estimate_model_scoped", None)
    if callable(coarse):
        try:
            return coarse(
                task,
                model_type=video_model,
                resolution=resolution,
            )
        except Exception:  # noqa: BLE001
            return None
    return None


def _confidence(match: str, sample_count: int) -> str:
    if match == MATCH_EXACT:
        return CONFIDENCE_HIGH if sample_count >= 5 else CONFIDENCE_MEDIUM
    if match == MATCH_FAMILY:
        return CONFIDENCE_MEDIUM if sample_count >= 5 else CONFIDENCE_LOW
    if match == MATCH_MODEL:
        return CONFIDENCE_LOW if sample_count >= 3 else CONFIDENCE_CALIBRATING
    return CONFIDENCE_CALIBRATING


def _policy_band(
    policy: Mapping[str, Any] | None,
    pixels: int,
) -> Optional[Mapping[str, Any]]:
    """Return the memory-policy band that covers ``pixels``.

    Bands are evaluated top-down, exactly as the runtime does: the first
    band whose ``min_pixels`` the canvas clears wins.
    """

    if not isinstance(policy, Mapping):
        return None
    for band in policy.get("resolution_bands") or []:
        if not isinstance(band, Mapping):
            continue
        if pixels < int(band.get("min_pixels", 0) or 0):
            continue
        return band
    return None


def _policy_tier_for_vram(
    band: Mapping[str, Any] | None,
    vram_gb: float,
) -> Optional[Mapping[str, Any]]:
    """Return the VRAM tier a card with ``vram_gb`` lands in."""

    if not isinstance(band, Mapping):
        return None
    for tier in band.get("vram_tiers") or []:
        if not isinstance(tier, Mapping):
            continue
        maximum = tier.get("max_vram_gb")
        if maximum is None or vram_gb <= float(maximum):
            return tier
    return None


def _policy_required_vram(
    band: Mapping[str, Any] | None,
    frames: int,
) -> Optional[float]:
    """Smallest VRAM class in ``band`` that can hold ``frames`` in one pass.

    ``None`` means the tier that fits has no published ceiling — the
    request is satisfiable, but only by a card larger than anything the
    policy names.
    """

    if not isinstance(band, Mapping):
        return None
    for tier in band.get("vram_tiers") or []:
        if not isinstance(tier, Mapping):
            continue
        tier_frames = tier.get("frames")
        if tier_frames is None:
            continue
        if int(tier_frames) < frames:
            continue
        maximum = tier.get("max_vram_gb")
        return float(maximum) if maximum is not None else None
    return None


def _vram_analysis(
    *,
    hardware: Mapping[str, Any],
    execution_profile: Mapping[str, Any] | None,
    execution_profile_error: str,
    memory_policy: Mapping[str, Any] | None,
    resolution: str,
    strategy: str,
    max_clip_frames: int,
    window_frames: Optional[int],
    observed_window_frames: Optional[int],
) -> dict[str, Any]:
    """Compare the render's peak memory against what this GPU can hold.

    The peak of a render is one pass: for a bounded model that is the
    whole shot, for a rolling-window model it is a single window.  The
    ceiling comes from whichever source the model publishes — the H3
    memory policy, the execution profile's one-pass limit — or, failing
    both, from the widest pass this machine has already produced for
    that model, which is a ceiling it has demonstrably survived.
    """

    gpu_vram_gb = _positive_float(hardware.get("gpu_vram_gb"))
    analysis: dict[str, Any] = {
        "gpu_vram_gb": gpu_vram_gb or None,
        "vram_required_gb": None,
        "max_frames_at_detected_vram": None,
        "effective_max_frames": None,
        "observed_window_frames": observed_window_frames,
        "fallback_resolution": None,
        "oom_risk": RISK_UNKNOWN,
        "reason": "",
    }

    profile = execution_profile if isinstance(execution_profile, Mapping) else {}
    effective_max = profile.get("effective_max_frames")
    if effective_max is not None:
        analysis["effective_max_frames"] = _positive_int(effective_max)
    analysis["fallback_resolution"] = profile.get("fallback_resolution") or None

    pixels = _resolution_pixels(
        profile.get("normalized_resolution") or resolution
    )
    band = _policy_band(memory_policy, pixels)
    tier = _policy_tier_for_vram(band, gpu_vram_gb)
    if tier is not None:
        tier_frames = tier.get("frames")
        analysis["max_frames_at_detected_vram"] = (
            int(tier_frames) if tier_frames is not None else None
        )
        if not analysis["fallback_resolution"]:
            analysis["fallback_resolution"] = (
                tier.get("fallback_resolution") or None
            )

    # The size under test: one pass of the render.
    peak_frames = (
        max_clip_frames if strategy != ROLLING_WINDOW else int(window_frames or 0)
    )
    analysis["peak_frames"] = peak_frames

    required = _policy_required_vram(band, peak_frames)
    if required is not None:
        analysis["vram_required_gb"] = required

    if execution_profile_error:
        analysis["oom_risk"] = RISK_HIGH
        analysis["reason"] = execution_profile_error
        return analysis

    limit = analysis["effective_max_frames"]
    limit_source = "the model's one-pass limit"
    if limit is None:
        limit = analysis["max_frames_at_detected_vram"]
        limit_source = "the model's memory policy"
    if limit is None and observed_window_frames:
        limit = int(observed_window_frames)
        limit_source = "the widest pass this GPU has already rendered"
    if limit is None:
        analysis["oom_risk"] = RISK_UNKNOWN
        analysis["reason"] = (
            "This model publishes no single-pass frame limit and this GPU "
            "has no rendering history for it, so the pre-flight cannot "
            "promise the render will fit in VRAM."
        )
        return analysis

    if peak_frames > limit:
        analysis["oom_risk"] = RISK_HIGH
        analysis["reason"] = (
            f"One pass of this render needs {peak_frames} frames, above "
            f"the {limit}-frame limit set by {limit_source}."
        )
    elif peak_frames >= limit * 0.9:
        analysis["oom_risk"] = RISK_MEDIUM
        analysis["reason"] = (
            f"One pass of this render needs {peak_frames} frames against a "
            f"{limit}-frame limit set by {limit_source} — very little headroom."
        )
    else:
        analysis["oom_risk"] = RISK_LOW
        analysis["reason"] = (
            f"One pass of this render needs {peak_frames} frames against a "
            f"{limit}-frame limit set by {limit_source}."
        )
    return analysis


def format_duration(seconds: float) -> str:
    """Render a duration the way the UI shows it."""

    total = max(0, int(round(_positive_float(seconds))))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def native_window_frames(
    model_def: Mapping[str, Any] | None,
    default_settings: Mapping[str, Any] | None,
    *,
    fps: float,
    min_frames: int,
    latent_size: int,
) -> int:
    """The model's trained (or published) rolling-window length.

    Mirrors the pipeline's own resolution: an explicit
    ``sliding_window_size``/``video_length`` in the model's defaults or
    settings wins, and a model that publishes neither is treated as a
    five-second native shot.
    """

    sources: list[Mapping[str, Any]] = []
    if isinstance(default_settings, Mapping):
        sources.append(default_settings)
    settings = (model_def or {}).get("settings")
    if isinstance(settings, Mapping):
        sources.append(settings)

    candidate: Optional[float] = None
    for source in sources:
        for key in ("sliding_window_size", "video_length"):
            value = _positive_float(source.get(key))
            if value > 0:
                candidate = round(value)
                break
        if candidate is not None:
            break
    if candidate is None:
        candidate = round(5 * fps)

    latent = max(1, int(latent_size or 1))
    minimum = max(1, int(min_frames or 1))
    return max(
        ((max(1, int(candidate)) - 1) // latent) * latent + 1,
        minimum,
    )


def resolve_window_frames(
    *,
    strategy: str,
    frame_counts: Sequence[int],
    fps: float,
    latent_size: int,
    native_window: Optional[int],
    supports_frame_injection: bool,
) -> int:
    """The rolling-window length the render will actually use.

    The pipeline picks one window length for the whole project, so the
    pre-flight must price the same geometry or the estimate describes a
    render that never happens.
    """

    max_clip = max(frame_counts) if frame_counts else round(5 * fps)
    if strategy != ROLLING_WINDOW:
        return max_clip
    has_sliding_window = any(frames > round(32 * fps) for frames in frame_counts)
    if native_window is None:
        return (
            round(20 * fps)
            if has_sliding_window
            else max_clip + max(1, int(latent_size or 1)) + 1
        )
    if supports_frame_injection and not has_sliding_window:
        return max_clip + max(1, int(latent_size or 1)) + 1
    return native_window


def build_preflight_report(
    *,
    planned_clips: Sequence[Mapping[str, Any]] = (),
    video_model: str = "",
    resolution: str = "",
    num_inference_steps: int = 8,
    fps: float = 25.0,
    frames_minimum: int = 1,
    latent_size: int = 1,
    window_frames: Optional[int] = None,
    window_overlap: int = 0,
    quantize_frames: Optional[bool] = None,
    model_def: Mapping[str, Any] | None = None,
    default_settings: Mapping[str, Any] | None = None,
    has_audio_guide: bool = False,
    has_start_images: bool = False,
    has_end_images: bool = False,
    activated_loras: Sequence[str] = (),
    loras_multipliers: str = "",
    eta_history: Any = None,
    hardware: Mapping[str, Any] | None = None,
    execution_profile: Mapping[str, Any] | None = None,
    execution_profile_error: str = "",
    memory_policy: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Price a Director plan before it is queued."""

    hardware = hardware if isinstance(hardware, Mapping) else {}
    clips = [clip for clip in (planned_clips or []) if isinstance(clip, Mapping)]
    fps_value = _positive_float(fps, 25.0) or 25.0
    steps = max(1, _positive_int(num_inference_steps, 8))
    minimum_frames = max(1, _positive_int(frames_minimum, 1))
    latent = max(1, _positive_int(latent_size, 1))

    warnings: list[dict[str, str]] = []

    strategy = video_strategy(model_def or {})
    if quantize_frames is None:
        quantize_frames = strategy == ROLLING_WINDOW

    durations = [clip_duration_seconds(clip) for clip in clips]
    frame_counts = standard_clip_frame_schedule(
        clips,
        fps=fps_value,
        min_clip_frames=minimum_frames,
    )
    if quantize_frames:
        frame_counts = quantize_clip_frame_schedule(
            frame_counts, minimum_frames, latent,
        )
    if window_frames is None:
        window_frames = resolve_window_frames(
            strategy=strategy,
            frame_counts=frame_counts,
            fps=fps_value,
            latent_size=latent,
            native_window=native_window_frames(
                model_def,
                default_settings,
                fps=fps_value,
                min_frames=minimum_frames,
                latent_size=latent,
            ),
            supports_frame_injection=bool(
                (model_def or {}).get("custom_frames_injection")
            ),
        )

    total_frames = sum(frame_counts)
    total_duration = sum(durations)

    # ---- time -------------------------------------------------------
    tasks: list[dict[str, Any]] = []
    per_clip: list[dict[str, Any]] = []
    active_total = 0.0
    setup_values: list[float] = []
    matches: list[str] = []
    sample_counts: list[int] = []

    for index, clip in enumerate(clips):
        frames = frame_counts[index]
        task = _synthetic_task(
            index,
            video_model=video_model,
            resolution=resolution,
            num_inference_steps=steps,
            fps=fps_value,
            frames=frames,
            window_frames=window_frames,
            window_overlap=window_overlap,
            has_audio_guide=has_audio_guide,
            has_start_images=has_start_images,
            has_end_images=has_end_images,
            activated_loras=activated_loras,
            loras_multipliers=loras_multipliers,
        )
        tasks.append(task)
        estimate = _estimate_clip(
            task,
            eta_history=eta_history,
            video_model=video_model,
            resolution=resolution,
        )
        clip_entry: dict[str, Any] = {
            "index": index,
            "start": _positive_float(clip.get("start")),
            "end": _positive_float(clip.get("end")),
            "duration_seconds": round(durations[index], 3),
            "frames": frames,
            "estimated_seconds": None,
            "eta_match": MATCH_NONE,
        }
        if estimate is not None:
            active = _positive_float(getattr(estimate, "active_seconds", 0.0))
            wall = _positive_float(getattr(estimate, "wall_seconds", 0.0))
            match = str(getattr(estimate, "match", MATCH_NONE) or MATCH_NONE)
            samples = max(0, _positive_int(getattr(estimate, "sample_count", 0)))
            active_total += active
            if wall > active:
                setup_values.append(wall - active)
            matches.append(match)
            sample_counts.append(samples)
            clip_entry["estimated_seconds"] = round(active, 1)
            clip_entry["eta_match"] = match
        per_clip.append(clip_entry)

    estimated_seconds: Optional[float] = None
    eta_match = MATCH_NONE
    eta_confidence = CONFIDENCE_CALIBRATING
    eta_samples = 0
    setup_seconds = 0.0
    join_seconds = 0.0

    if matches:
        # The strongest source wins; a batch of shots priced by one
        # history entry is only as trustworthy as its weakest shot.
        rank = {MATCH_EXACT: 3, MATCH_FAMILY: 2, MATCH_MODEL: 1}
        eta_match = min(matches, key=lambda value: -rank.get(value, 0))
        eta_samples = max(sample_counts)
        eta_confidence = _confidence(eta_match, eta_samples)
        setup_seconds = statistics.median(setup_values) if setup_values else 0.0
        join_seconds = estimate_join_overhead_seconds(tasks)
        orchestration = _SECONDS_PER_CLIP_BOUNDARY * max(0, len(tasks) - 1)
        estimated_seconds = (
            active_total + setup_seconds + orchestration + join_seconds
        )

    # ---- VRAM -------------------------------------------------------
    max_clip_frames = max(frame_counts) if frame_counts else 0
    observed = None
    observed_getter = getattr(eta_history, "observed_window_frames", None)
    if callable(observed_getter):
        try:
            observed = observed_getter(
                model_type=video_model,
                resolution=resolution,
            )
        except Exception:  # noqa: BLE001
            observed = None
    vram = _vram_analysis(
        hardware=hardware,
        execution_profile=execution_profile,
        execution_profile_error=execution_profile_error,
        memory_policy=memory_policy,
        resolution=resolution,
        strategy=strategy,
        max_clip_frames=max_clip_frames,
        window_frames=window_frames,
        observed_window_frames=observed,
    )

    # ---- warnings ----------------------------------------------------
    if not clips:
        warnings.append(
            _warning(
                "no_clips",
                SEVERITY_INFO,
                "Director has not planned any shot yet, so there is nothing "
                "to price.",
            )
        )
    if clips and estimated_seconds is None:
        warnings.append(
            _warning(
                "no_eta_history",
                SEVERITY_WARNING,
                "This machine has no timing history for this model and "
                "resolution yet, so the duration estimate is unavailable. "
                "The first render teaches the estimator.",
            )
        )
    elif eta_confidence == CONFIDENCE_LOW:
        warnings.append(
            _warning(
                "low_eta_confidence",
                SEVERITY_INFO,
                "The estimate is extrapolated from a few local samples; treat "
                "it as an order of magnitude, not a promise.",
            )
        )
    if vram["oom_risk"] == RISK_HIGH:
        warnings.append(
            _warning(
                "oom_risk",
                SEVERITY_ERROR,
                vram["reason"]
                + (
                    f" Lower the resolution to {vram['fallback_resolution']}."
                    if vram.get("fallback_resolution") else ""
                ),
            )
        )
    elif vram["oom_risk"] == RISK_MEDIUM:
        warnings.append(
            _warning("vram_headroom", SEVERITY_WARNING, vram["reason"])
        )
    if len(clips) > _MANY_CLIPS:
        warnings.append(
            _warning(
                "many_clips",
                SEVERITY_WARNING,
                f"This project renders {len(clips)} separate shots. Each one "
                "pays a queue hand-off, so the queue will take noticeably "
                "longer than the footage suggests.",
            )
        )
    long_shots = [
        index
        for index, duration in enumerate(durations)
        if duration > _ROLLING_WINDOW_SECONDS
    ]
    if long_shots:
        warnings.append(
            _warning(
                "rolling_window",
                SEVERITY_INFO,
                f"{len(long_shots)} shot(s) run longer than "
                f"{int(_ROLLING_WINDOW_SECONDS)}s and will be rendered "
                "through the rolling-window path, which is slower per second "
                "of footage than a single pass.",
            )
        )
    if (
        estimated_seconds is not None
        and estimated_seconds >= _LONG_RENDER_SECONDS
    ):
        warnings.append(
            _warning(
                "long_render",
                SEVERITY_WARNING,
                f"This render is estimated at {format_duration(estimated_seconds)} "
                "of GPU time. Consider a shorter cut, fewer shots, or a lower "
                "resolution.",
            )
        )
    if clips and not vram.get("gpu_vram_gb"):
        warnings.append(
            _warning(
                "vram_unknown",
                SEVERITY_INFO,
                "No GPU was detected on this machine, so the VRAM check is "
                "unavailable and the estimate is theoretical.",
            )
        )

    return {
        "schema": PREFLIGHT_SCHEMA_VERSION,
        "video_model": video_model,
        "resolution": resolution,
        "fps": fps_value,
        "num_inference_steps": steps,
        "video_strategy": strategy,
        "window_frames": window_frames,
        "clip_count": len(clips),
        "total_duration_seconds": round(total_duration, 3),
        "total_frames": total_frames,
        "max_clip_frames": max_clip_frames,
        "per_clip": per_clip,
        "estimated_seconds": (
            round(estimated_seconds, 1) if estimated_seconds is not None else None
        ),
        "estimated_clip_seconds": (
            round(estimated_seconds / len(clips), 1)
            if estimated_seconds is not None and clips
            else None
        ),
        "eta_confidence": eta_confidence,
        "eta_match": eta_match,
        "eta_samples": eta_samples,
        "setup_seconds": round(setup_seconds, 1),
        "join_seconds": round(join_seconds, 1),
        "gpu_vram_gb": vram.get("gpu_vram_gb"),
        "vram_required_gb": vram.get("vram_required_gb"),
        "max_frames_at_detected_vram": vram.get("max_frames_at_detected_vram"),
        "effective_max_frames": vram.get("effective_max_frames"),
        "peak_frames": vram.get("peak_frames"),
        "observed_window_frames": vram.get("observed_window_frames"),
        "oom_risk": vram["oom_risk"],
        "oom_reason": vram["reason"],
        "fallback_resolution": vram.get("fallback_resolution"),
        "warnings": warnings,
    }


__all__ = [
    "CONFIDENCE_CALIBRATING",
    "CONFIDENCE_HIGH",
    "CONFIDENCE_LOW",
    "CONFIDENCE_MEDIUM",
    "MATCH_EXACT",
    "MATCH_FAMILY",
    "MATCH_MODEL",
    "MATCH_NONE",
    "PREFLIGHT_SCHEMA_VERSION",
    "RISK_HIGH",
    "RISK_LOW",
    "RISK_MEDIUM",
    "RISK_UNKNOWN",
    "build_preflight_report",
    "format_duration",
]
