"""Script-driven clip structure for the Director.

The audio analysis decides *where the music breathes*; the briefing
decides *where the story cuts*.  A Director briefing may carry explicit
timecodes::

    CENA 2: A Entrada de Gary (0:11 - 0:28)
    Visual: Plano médio-conjunto ...
    0:11 - 0:20: A câmera foca em Gary ...

Those timecodes are the author's intended shot boundaries, so when a
briefing provides them the clip plan must honour them instead of the
energy-based section split produced by
:func:`services.audio_analysis.plan_clip_structure`.  Without this the
briefing can only *decorate* the plan: the planner binds whole scenes to
whatever cuts the audio happened to produce, and a four-minute track
scripted with twelve scenes still yields a dozen long shots.

Two granularities are supported:

``scene``
    One shot per ``CENA`` block.
``beat``
    One shot per sub-segment (``0:11 - 0:20``).  This is the
    music-video rhythm: a four-minute track scripted with twelve scenes
    and twenty-five sub-segments yields twenty-five shots instead of
    twelve.

Script cuts honour the author's explicit timecodes.  The only hard
constraint applied on top of them is the model's own frame floor, so a
deliberate five-second shot survives on a model that can render it and
is merged on one that cannot.
"""

from __future__ import annotations

import math
from typing import Any, Optional


#: Granularities a script-driven plan can be built at.
GRANULARITY_SCENE = "scene"
GRANULARITY_BEAT = "beat"
GRANULARITIES = (GRANULARITY_SCENE, GRANULARITY_BEAT)

#: Absolute floor for a cut, in seconds.  The model's frame minimum is
#: the real constraint; this only rejects degenerate zero-length cuts.
_ABSOLUTE_MIN_SECONDS = 1.0

#: Cuts closer than this are considered contiguous when the script
#: leaves a sliver of audio uncovered.
_GAP_EPSILON = 0.05

#: Upper bound on the shots a script-driven plan may produce. The
#: timeline editor accepts at most 200 slots, so a plan with more cuts
#: than that could not be reviewed or adjusted before generation.
MAX_SCRIPT_CLIPS = 200


def _script_dict(script: Any) -> dict[str, Any]:
    if hasattr(script, "to_dict"):
        return script.to_dict()
    if isinstance(script, dict):
        return script
    return {"scenes": []}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def _script_units(
    script: Any,
    granularity: str,
    window_start: float,
    window_end: float,
) -> list[tuple[float, float]]:
    """Return the script's cut points as ``(start, end)`` pairs.

    ``scene`` granularity keeps one unit per ``CENA`` block; ``beat``
    granularity keeps one unit per sub-segment.  Scenes without
    sub-segments fall back to the scene itself in both modes, so a
    script written at either level always produces a usable plan.
    """
    units: list[tuple[float, float]] = []
    for scene in _script_dict(script).get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        start = scene.get("start")
        end = scene.get("end")
        if start is None or end is None:
            continue
        try:
            start = float(start)
            end = float(end)
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        beats = scene.get("beats") or []
        if granularity == GRANULARITY_BEAT and beats:
            for beat in beats:
                if not isinstance(beat, dict):
                    continue
                b_start = beat.get("start")
                b_end = beat.get("end")
                if b_start is None or b_end is None:
                    continue
                try:
                    b_start = float(b_start)
                    b_end = float(b_end)
                except (TypeError, ValueError):
                    continue
                if b_end <= b_start:
                    continue
                b_start = _clamp(b_start, window_start, window_end)
                b_end = _clamp(b_end, window_start, window_end)
                if b_end > b_start:
                    units.append((b_start, b_end))
            continue
        start = _clamp(start, window_start, window_end)
        end = _clamp(end, window_start, window_end)
        if end > start:
            units.append((start, end))
    units.sort()
    return units


def _split_points(
    script: Any,
    analysis: dict,
) -> tuple[list[float], list[float]]:
    """Interior cut points, most specific first.

    The first list holds the script's own sub-segment boundaries — the
    author's own idea of where the shot changes — and the second the
    audio beat grid, used only when the author left a scene undivided.
    Keeping them apart lets a long scene split on the boundary the
    author drew instead of on an arbitrary beat.
    """
    preferred: list[float] = []
    for scene in _script_dict(script).get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        for beat in scene.get("beats") or []:
            if not isinstance(beat, dict):
                continue
            for key in ("start", "end"):
                value = beat.get(key)
                if value is None:
                    continue
                try:
                    preferred.append(float(value))
                except (TypeError, ValueError):
                    continue
    fallback: list[float] = []
    for beat in analysis.get("beats") or []:
        value = beat.get("time") if isinstance(beat, dict) else getattr(beat, "time", None)
        if value is None:
            continue
        try:
            fallback.append(float(value))
        except (TypeError, ValueError):
            continue
    return sorted(set(preferred)), sorted(set(fallback))


def _split_long_units(
    units: list[tuple[float, float]],
    max_seconds: float,
    split_points: tuple[list[float], list[float]],
) -> list[tuple[float, float]]:
    """Cut units longer than *max_seconds* into balanced parts.

    A script scene may legitimately outlast a single generation window
    (the planner supports rolling windows for that).  Splitting happens
    only when the unit is longer than the model can render in one go.

    The split is *balanced*: a 27-second scene becomes two roughly
    equal halves rather than a 26-second shot followed by a 1-second
    runt.  Where the author drew sub-segment boundaries they win over
    the audio beat grid, so the cut still lands where the script says.
    """
    if max_seconds <= 0:
        return list(units)
    preferred, fallback = split_points
    result: list[tuple[float, float]] = []
    for start, end in units:
        duration = end - start
        if duration <= max_seconds + _GAP_EPSILON:
            result.append((start, end))
            continue
        count = max(2, int(math.ceil(duration / max_seconds)))
        # Ideal boundaries divide the unit into equal parts.
        targets = [start + (duration * index / count) for index in range(1, count)]
        boundaries: list[float] = []
        for target in targets:
            chosen = _nearest_point(target, preferred, start, end)
            if chosen is None:
                chosen = _nearest_point(target, fallback, start, end)
            if chosen is None:
                continue
            if boundaries and chosen <= boundaries[-1]:
                continue
            boundaries.append(chosen)
        cursor = start
        for boundary in boundaries:
            result.append((cursor, boundary))
            cursor = boundary
        if end - cursor > _GAP_EPSILON:
            result.append((cursor, end))
    return result


def _cap_units(
    units: list[tuple[float, float]],
    max_count: int,
) -> list[tuple[float, float]]:
    """Reduce the cut count to *max_count* by grouping neighbouring cuts.

    A script may name far more moments than the pipeline can stage.
    Rather than refuse the script, the cuts are grouped into contiguous
    runs of roughly equal size until the plan fits — the timeline
    editor accepts at most 200 slots, so a plan beyond that could not
    be reviewed anyway.
    """
    total = len(units)
    if max_count <= 0 or total <= max_count:
        return list(units)
    bounds = [0]
    bounds.extend(
        max(1, min(total - 1, round(index * total / max_count)))
        for index in range(1, max_count)
    )
    bounds.append(total)
    grouped: list[tuple[float, float]] = []
    for start_index, end_index in zip(bounds, bounds[1:]):
        if end_index <= start_index:
            continue
        grouped.append((units[start_index][0], units[end_index - 1][1]))
    return grouped


def _nearest_point(
    target: float,
    candidates: list[float],
    low: float,
    high: float,
) -> Optional[float]:
    """Candidate closest to *target* that still lies strictly inside."""
    interior = [
        point for point in candidates
        if low + _GAP_EPSILON < point < high - _GAP_EPSILON
    ]
    if not interior:
        return None
    return min(interior, key=lambda point: (abs(point - target), point))


def _merge_short_units(
    units: list[tuple[float, float]],
    min_seconds: float,
) -> list[tuple[float, float]]:
    """Merge cuts shorter than *min_seconds* into their neighbour.

    A cut the model cannot render is not a shot; it is a cut the
    author drew too tight.  Merging forward keeps the earliest
    requested start, so the shot still begins where the script said.
    """
    if min_seconds <= 0 or not units:
        return list(units)
    merged: list[tuple[float, float]] = []
    pending_start: Optional[float] = None
    pending_end: Optional[float] = None
    for start, end in units:
        if pending_start is None:
            pending_start, pending_end = start, end
            continue
        if pending_end - pending_start < min_seconds:
            # The pending cut is too short to render on its own, so it
            # absorbs the next one instead of becoming a shot.
            pending_end = max(pending_end, end)
            continue
        merged.append((pending_start, pending_end))
        pending_start, pending_end = start, end
    if pending_start is not None:
        if merged and pending_end - pending_start < min_seconds:
            last_start, last_end = merged[-1]
            merged[-1] = (last_start, max(last_end, pending_end))
        else:
            merged.append((pending_start, pending_end))
    return merged


def _audio_fill(
    analysis: dict,
    start: float,
    end: float,
    *,
    energy_bias: int,
    fps: int,
    frames_steps: int,
    frames_minimum: int,
    total_duration: Optional[float],
) -> list[dict]:
    """Plan the audio regions the script did not cover.

    A script that describes only part of a track still has to leave the
    rest of the soundtrack on screen, otherwise the video would jump
    over the missing audio.  The audio planner already knows how to
    split a stretch of music into shots, so it fills those gaps.
    """
    if end - start <= _GAP_EPSILON:
        return []
    try:
        from ..audio_analysis import plan_clip_structure
    except Exception:  # pragma: no cover - defensive import guard
        return []
    try:
        return plan_clip_structure(
            analysis,
            energy_bias=energy_bias,
            fps=fps,
            frames_steps=frames_steps,
            frames_minimum=frames_minimum,
            total_duration=total_duration,
            window_start=start,
            window_end=end,
        )
    except Exception:
        return []


def _section_at(
    analysis: dict,
    moment: float,
) -> tuple[str, float]:
    """Section label and energy at *moment*, falling back to ``verse``."""
    for section in analysis.get("sections") or []:
        if not isinstance(section, dict):
            continue
        start = section.get("start")
        end = section.get("end")
        if start is None or end is None:
            continue
        try:
            if float(start) <= moment < float(end):
                label = str(section.get("label") or "verse")
                energy = section.get("energy")
                try:
                    energy_value = float(energy)
                except (TypeError, ValueError):
                    energy_value = 0.5
                return label, energy_value
        except (TypeError, ValueError):
            continue
    return "verse", 0.5


def _dominant_speaker(analysis: dict, start: float, end: float) -> Optional[str]:
    counts: dict[str, int] = {}
    for lyric in analysis.get("lyrics") or []:
        if not isinstance(lyric, dict):
            continue
        speaker = lyric.get("speaker")
        if not speaker:
            continue
        try:
            lyric_start = float(lyric.get("start", 0))
            lyric_end = float(lyric.get("end", 0))
        except (TypeError, ValueError):
            continue
        if lyric_start < end and lyric_end > start:
            counts[speaker] = counts.get(speaker, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


def _annotate(
    analysis: dict,
    start: float,
    end: float,
    *,
    fps: int,
    frames_steps: int,
    frames_minimum: int,
) -> dict:
    """Describe a cut using the audio analysis."""
    try:
        from ..audio_analysis import _snap_to_valid_frames

        duration_frames = _snap_to_valid_frames(
            end - start, fps, frames_steps, frames_minimum
        )
    except Exception:  # pragma: no cover - defensive import guard
        duration_frames = max(frames_minimum, round((end - start) * fps))

    label, energy = _section_at(analysis, start + (end - start) / 2.0)
    beat_count = 0
    for beat in analysis.get("beats") or []:
        value = beat.get("time") if isinstance(beat, dict) else getattr(beat, "time", None)
        if value is None:
            continue
        try:
            beat_time = float(value)
        except (TypeError, ValueError):
            continue
        if start <= beat_time < end:
            beat_count += 1
    if beat_count == 0:
        bpm = analysis.get("bpm") or 120.0
        try:
            bpm = float(bpm)
        except (TypeError, ValueError):
            bpm = 120.0
        if bpm <= 0:
            bpm = 120.0
        beat_count = max(1, round((end - start) / (60.0 / bpm)))

    if energy > 0.6:
        energy_desc = "high energy"
    elif energy < 0.3:
        energy_desc = "low energy"
    else:
        energy_desc = "moderate energy"

    return {
        "start": round(start, 3),
        "end": round(end, 3),
        "beat_count": beat_count,
        "section_label": label,
        "energy": round(energy, 3),
        "suggested_prompt_hint": f"{label}, {energy_desc}",
        "duration_frames": duration_frames,
        "dominant_speaker": _dominant_speaker(analysis, start, end),
    }


def plan_script_clip_structure(
    script: Any,
    analysis: dict,
    *,
    granularity: str = GRANULARITY_BEAT,
    energy_bias: int = 0,
    fps: int = 16,
    frames_steps: int = 4,
    frames_minimum: int = 5,
    total_duration: Optional[float] = None,
    window_start: Optional[float] = None,
    window_end: Optional[float] = None,
) -> list[dict]:
    """Plan clips from a time-anchored briefing.

    Args:
        script: Parsed scene script (a :class:`SceneScript` or its dict
            form).
        analysis: Audio analysis dict, used to annotate the cuts.
        granularity: ``scene`` for one shot per ``CENA`` block,
            ``beat`` for one shot per sub-segment.
        energy_bias: Pacing bias applied to the audio-filled regions.
        fps, frames_steps, frames_minimum: Model frame parameters.
        total_duration: Length of the source track, when known.
        window_start, window_end: Restrict the plan to a slice of the
            source timeline.

    Returns:
        A list of clip dicts shaped like the audio planner's output.
    """
    if granularity not in GRANULARITIES:
        granularity = GRANULARITY_BEAT
    analysis = analysis or {}
    script_dict = _script_dict(script)
    anchored = [
        scene for scene in (script_dict.get("scenes") or [])
        if isinstance(scene, dict) and scene.get("start") is not None
    ]
    if not anchored:
        return []

    try:
        from ..audio_analysis import MAX_CLIP_SECONDS
    except Exception:  # pragma: no cover - defensive import guard
        MAX_CLIP_SECONDS = 26.0

    song_duration = total_duration or analysis.get("duration") or 0.0
    try:
        song_duration = float(song_duration)
    except (TypeError, ValueError):
        song_duration = 0.0

    low = 0.0 if window_start is None else max(0.0, float(window_start))
    high = song_duration if window_end is None else float(window_end)
    if song_duration > 0:
        high = min(high, song_duration)
    high = max(low, high)
    if high - low <= _GAP_EPSILON:
        return []

    units = _script_units(script_dict, granularity, low, high)
    if not units:
        return []

    try:
        model_min = float(frames_minimum) / float(fps) if fps else 0.0
    except (TypeError, ValueError, ZeroDivisionError):
        model_min = 0.0
    min_seconds = max(_ABSOLUTE_MIN_SECONDS, model_min)

    units = _split_long_units(units, float(MAX_CLIP_SECONDS), _split_points(script_dict, analysis))
    units = _merge_short_units(units, min_seconds)
    units = _cap_units(units, MAX_SCRIPT_CLIPS)

    # Fill the stretches the script never mentioned so the timeline
    # stays continuous over the whole window.
    segments: list[tuple[float, float]] = []
    cursor = low
    for start, end in units:
        if start - cursor > _GAP_EPSILON:
            segments.extend(
                (float(clip.get("start") or 0.0), float(clip.get("end") or 0.0))
                for clip in _audio_fill(
                    analysis, cursor, start,
                    energy_bias=energy_bias,
                    fps=fps,
                    frames_steps=frames_steps,
                    frames_minimum=frames_minimum,
                    total_duration=total_duration,
                )
            )
        segments.append((start, end))
        cursor = max(cursor, end)
    if high - cursor > _GAP_EPSILON:
        segments.extend(
            (float(clip.get("start") or 0.0), float(clip.get("end") or 0.0))
            for clip in _audio_fill(
                analysis, cursor, high,
                energy_bias=energy_bias,
                fps=fps,
                frames_steps=frames_steps,
                frames_minimum=frames_minimum,
                total_duration=total_duration,
            )
        )

    clips = [
        _annotate(
            analysis, start, end,
            fps=fps,
            frames_steps=frames_steps,
            frames_minimum=frames_minimum,
        )
        for start, end in segments
    ]
    clips.sort(key=lambda clip: float(clip.get("start") or 0.0))
    return clips


__all__ = [
    "GRANULARITIES",
    "GRANULARITY_BEAT",
    "GRANULARITY_SCENE",
    "plan_script_clip_structure",
]
