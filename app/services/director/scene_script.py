"""Parse a Director briefing into a time-anchored scene script.

The Description field is free-form prose. When a user writes a script
with explicit scene boundaries — ``CENA 2: Entrada de Gary (0:11 - 0:28)``
— those timecodes are the only place where the user states *which part of
the audio* a scene belongs to. Historically the Director ignored them
entirely: the whole briefing was forwarded to the planner as one global
"Scene Concept" string, while the clip timeline was derived only from the
analysed audio. A 45-second script dropped on a 4:15 track therefore
produced a full-length music video whose first three shots happened to
carry the script and whose remaining ten shots were invented.

This module turns the briefing into structured, JSON-friendly data:

* :func:`parse_scene_script` splits the text into a preamble (global
  style notes that belong to no single scene) and an ordered list of
  scenes carrying their own timecode window.
* :func:`reconcile_scene_script` compares the covered span against the
  real audio duration so the UI can say "your script covers 0:45 of 4:15"
  instead of silently planning the whole track.

Everything here is pure text handling — no audio, no filesystem, no LLM.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

# Scene headers: "CENA 1: Nome", "CENA 1 - Nome", "Scene 3 — Title".
_HEADER_RE = re.compile(
    r"^[ \t]*(?P<kind>cena|scene|escena|cap[ií]tulo)[ \t]*(?P<num>\d+)"
    r"[ \t]*(?P<sep>[:.\-–—][ \t]*)?(?P<rest>.*)$",
    re.IGNORECASE,
)

# A parenthesised (or bracketed) time range inside the header line.
_RANGE_RE = re.compile(
    r"[([]\s*(?P<start>\d{1,2}(?::\d{1,2}){0,2}(?:\.\d+)?)\s*"
    r"(?:-|–|—|to|a|até)\s*"
    r"(?P<end>\d{1,2}(?::\d{1,2}){0,2}(?:\.\d+)?)\s*[)\]]",
    re.IGNORECASE,
)

# Quoted lyric / dialogue fragments inside a scene body.
_QUOTE_RE = re.compile(r"[\"“]([^\"”\n]{2,400})[\"”]")

_STATUS_FULL_TRACK = "full_track"
_STATUS_EXCERPT = "excerpt"
_STATUS_NO_TIMECODES = "no_timecodes"


def parse_timecode(raw: str) -> Optional[float]:
    """Convert ``12``, ``1:30`` or ``0:01:30`` into seconds."""
    text = str(raw or "").strip()
    if not text:
        return None
    parts = text.split(":")
    if len(parts) > 3:
        return None
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        return None
    if len(numbers) == 1:
        return numbers[0]
    if len(numbers) == 2:
        return numbers[0] * 60.0 + numbers[1]
    return numbers[0] * 3600.0 + numbers[1] * 60.0 + numbers[2]


@dataclass
class ScriptScene:
    """One ``CENA N (start - end)`` block of the briefing."""

    index: int
    title: str
    start: Optional[float]
    end: Optional[float]
    body: str
    body_plain: str
    quotes: list[str] = field(default_factory=list)

    @property
    def anchored(self) -> bool:
        return self.start is not None and self.end is not None

    @property
    def duration(self) -> Optional[float]:
        if self.start is None or self.end is None:
            return None
        return max(0.0, self.end - self.start)

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "title": self.title,
            "start": self.start,
            "end": self.end,
            "body": self.body,
            "body_plain": self.body_plain,
            "quotes": list(self.quotes),
        }


@dataclass
class SceneScript:
    """The briefing split into a preamble plus an ordered scene list."""

    scenes: list[ScriptScene] = field(default_factory=list)
    global_style: str = ""

    @property
    def anchored_scenes(self) -> list[ScriptScene]:
        return [scene for scene in self.scenes if scene.anchored]

    @property
    def anchored(self) -> bool:
        """True when at least one scene carries a usable timecode."""
        return bool(self.anchored_scenes)

    @property
    def span(self) -> Optional[tuple[float, float]]:
        """Covered audio window of the script, or ``None`` when unanchored."""
        anchored = self.anchored_scenes
        if not anchored:
            return None
        start = min(scene.start for scene in anchored)  # type: ignore[type-var]
        end = max(scene.end for scene in anchored)  # type: ignore[type-var]
        return (float(start), float(end))

    def to_dict(self) -> dict[str, Any]:
        span = self.span
        return {
            "scenes": [scene.to_dict() for scene in self.scenes],
            "global_style": self.global_style,
            "span": list(span) if span else None,
            "anchored": bool(self.anchored_scenes),
        }


def _strip_quotes(text: str) -> tuple[str, list[str]]:
    """Remove quoted fragments, returning the remaining text and the quotes."""
    quotes: list[str] = []

    def _capture(match: re.Match[str]) -> str:
        quotes.append(match.group(1).strip())
        return " "

    body_plain = _QUOTE_RE.sub(_capture, text)
    body_plain = re.sub(r"[ \t]{2,}", " ", body_plain)
    body_plain = re.sub(r"\n{3,}", "\n\n", body_plain)
    return body_plain.strip(), quotes


def _clean_title(text: str) -> str:
    title = text.strip()
    title = re.sub(r"^[\s:.\-–—]+", "", title)
    title = re.sub(r"[\s:.\-–—]+$", "", title)
    return title.strip()


def parse_scene_script(text: str) -> SceneScript:
    """Split a Director briefing into preamble + time-anchored scenes.

    Unparseable briefings still return a usable result: the whole text
    becomes the preamble and no scene is anchored, which keeps the
    existing "global concept only" behaviour intact.
    """
    source = str(text or "")
    if not source.strip():
        return SceneScript(scenes=[], global_style="")

    lines = source.splitlines()
    preamble: list[str] = []
    scenes: list[ScriptScene] = []
    current: Optional[dict[str, Any]] = None

    def _flush() -> None:
        nonlocal current
        if current is None:
            return
        body = "\n".join(current.pop("lines")).strip()
        body_plain, quotes = _strip_quotes(body)
        scenes.append(ScriptScene(
            index=int(current["num"]),
            title=current["title"],
            start=current["start"],
            end=current["end"],
            body=body,
            body_plain=body_plain,
            quotes=quotes,
        ))
        current = None

    for raw_line in lines:
        header = _HEADER_RE.match(raw_line)
        if not header:
            if current is not None:
                current["lines"].append(raw_line)
            else:
                preamble.append(raw_line)
            continue

        rest = header.group("rest") or ""
        range_match = _RANGE_RE.search(rest)
        start: Optional[float] = None
        end: Optional[float] = None
        title_text = rest
        if range_match:
            start = parse_timecode(range_match.group("start"))
            end = parse_timecode(range_match.group("end"))
            if start is None or end is None:
                start = end = None
            else:
                title_text = rest[:range_match.start()] + rest[range_match.end():]

        _flush()
        current = {
            "num": header.group("num"),
            "title": _clean_title(title_text),
            "start": start,
            "end": end,
            "lines": [],
        }

    _flush()

    global_style = "\n".join(preamble).strip()
    if not global_style and scenes and not any(scene.anchored for scene in scenes):
        # A briefing made only of unanchored scene headers still deserves a
        # readable concept; fall back to the raw titles.
        global_style = "; ".join(scene.title for scene in scenes if scene.title)

    return SceneScript(scenes=scenes, global_style=global_style)


def _as_script_dict(script: Any) -> dict[str, Any]:
    """Normalise a script to its dict form.

    Accepts both :class:`SceneScript` instances and the plain dicts that
    cross an HTTP boundary, so callers do not have to remember which
    representation they are holding.
    """
    if isinstance(script, SceneScript):
        return script.to_dict()
    if isinstance(script, dict):
        return script
    return {"scenes": [], "global_style": "", "span": None, "anchored": False}


def scenes_overlapping(
    script: Any,
    start: float,
    end: float,
) -> list[dict[str, Any]]:
    """Return the scenes of *script* whose window overlaps ``[start, end]``.

    ``script`` may be a :class:`SceneScript` or the dict form produced by
    :meth:`SceneScript.to_dict`, so the helper also works on payloads that
    crossed an HTTP boundary.
    """
    try:
        low = float(start)
        high = float(end)
    except (TypeError, ValueError):
        return []
    matched: list[dict[str, Any]] = []
    for scene in _as_script_dict(script).get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        scene_start = scene.get("start")
        scene_end = scene.get("end")
        if scene_start is None or scene_end is None:
            continue
        try:
            scene_start = float(scene_start)
            scene_end = float(scene_end)
        except (TypeError, ValueError):
            continue
        if scene_start < high and scene_end > low:
            matched.append(scene)
    return matched


def script_span(script: Any) -> Optional[tuple[float, float]]:
    """Covered window of a script, or ``None``."""
    scenes = _as_script_dict(script).get("scenes") or []
    starts: list[float] = []
    ends: list[float] = []
    for scene in scenes:
        if not isinstance(scene, dict):
            continue
        if scene.get("start") is None or scene.get("end") is None:
            continue
        try:
            starts.append(float(scene["start"]))
            ends.append(float(scene["end"]))
        except (TypeError, ValueError):
            continue
    if not starts:
        return None
    return (min(starts), max(ends))


@dataclass
class ScriptReport:
    """How much of the analysed audio the briefing actually covers."""

    status: str = _STATUS_NO_TIMECODES
    scene_count: int = 0
    anchored_scene_count: int = 0
    audio_duration: Optional[float] = None
    covered_start: Optional[float] = None
    covered_end: Optional[float] = None
    covered_seconds: Optional[float] = None
    coverage_ratio: Optional[float] = None
    uncovered_seconds: Optional[float] = None
    gaps: list[dict[str, float]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "scene_count": self.scene_count,
            "anchored_scene_count": self.anchored_scene_count,
            "audio_duration": self.audio_duration,
            "covered_start": self.covered_start,
            "covered_end": self.covered_end,
            "covered_seconds": self.covered_seconds,
            "coverage_ratio": self.coverage_ratio,
            "uncovered_seconds": self.uncovered_seconds,
            "gaps": [dict(gap) for gap in self.gaps],
        }


def reconcile_scene_script(
    script: Any,
    audio_duration: Optional[float] = None,
) -> ScriptReport:
    """Compare the script's covered span against the real audio duration.

    The returned report drives the briefing banner: it tells the user
    whether the script describes the whole track, only an excerpt of it,
    or carries no usable timecodes at all.
    """
    script = _as_script_dict(script)
    span = script_span(script)
    try:
        duration = float(audio_duration) if audio_duration else None
    except (TypeError, ValueError):
        duration = None

    scenes = script.get("scenes") or []
    report = ScriptReport(
        status=_STATUS_NO_TIMECODES,
        scene_count=len(scenes),
        anchored_scene_count=sum(
            1 for scene in scenes
            if isinstance(scene, dict) and scene.get("start") is not None
        ),
        audio_duration=duration,
        covered_start=span[0] if span else None,
        covered_end=span[1] if span else None,
        covered_seconds=(span[1] - span[0]) if span else None,
    )

    if span is None:
        return report

    covered = max(0.0, span[1] - span[0])
    report.covered_seconds = covered
    if duration and duration > 0:
        report.coverage_ratio = round(min(1.0, covered / duration), 4)
        report.uncovered_seconds = round(max(0.0, duration - covered), 3)
        report.status = (
            _STATUS_FULL_TRACK if covered >= duration - 1.0 else _STATUS_EXCERPT
        )
    else:
        report.status = _STATUS_EXCERPT

    ordered = sorted(
        (
            scene for scene in scenes
            if isinstance(scene, dict) and scene.get("start") is not None
            and scene.get("end") is not None
        ),
        key=lambda scene: float(scene["start"]),
    )
    gaps: list[dict[str, float]] = []
    cursor: Optional[float] = None
    for scene in ordered:
        scene_start = float(scene["start"])
        scene_end = float(scene["end"])
        if cursor is not None and scene_start - cursor > 0.5:
            gaps.append({"start": round(cursor, 3), "end": round(scene_start, 3)})
        cursor = max(cursor or 0.0, scene_end)
    report.gaps = gaps
    return report
