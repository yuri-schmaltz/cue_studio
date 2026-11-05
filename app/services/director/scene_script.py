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
# Markdown headings and emphasis are tolerated because real briefs are
# written as "### **CENA 1: Nome (0:00 - 0:11)**".
_HEADER_RE = re.compile(
    r"^[ \t]*(?:#{1,6}[ \t]*)?[*_]{0,3}[ \t]*"
    r"(?P<kind>cena|scene|escena|cap[ií]tulo)[ \t]*(?P<num>\d+)"
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
_HEADER_CLOCK_RANGE_RE = re.compile(
    r"(?<![\d:])(?P<start>\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*"
    r"(?:-|–|—|to|a|até)\s*(?P<end>\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)(?![\d:])",
    re.IGNORECASE,
)
_ACT_HEADER_RE = re.compile(r"^\s*(?:#{1,6}\s*)?[*_]{0,3}(?:ato|act)\s+(?:[IVXLCDM]+|\d+)\b", re.IGNORECASE)

# A sub-beat inside a scene body: "- **0:00 - 0:05:** A mão se posiciona".
# These are the fine-grained anchors that let a shot line up with the
# exact second of the track it describes.
_BEAT_RE = re.compile(
    r"^[ \t]*(?:[-*+][ \t]*)?[*_]{0,3}[ \t]*"
    r"(?P<start>\d{1,2}(?::\d{1,2}){0,2}(?:\.\d+)?|\d+(?:\.\d+)?)[ \t]*"
    r"(?:-|–|—|to|a|até)[ \t]*"
    r"(?P<end>\d{1,2}(?::\d{1,2}){0,2}(?:\.\d+)?|\d+(?:\.\d+)?)[ \t]*"
    r"[*_]{0,3}[ \t]*[:：]?[ \t]*(?P<rest>.*)$"
)

# The per-scene shot plan: "- **Visual:** Plano macro de massinha...".
_VISUAL_RE = re.compile(
    r"^[ \t]*(?:[-*+][ \t]*)?[*_]{0,3}[ \t]*"
    r"(?P<label>visual|enquadramento|shot|corte|plano)[ \t]*[*_]{0,3}[ \t]*[:：][ \t]*"
    r"(?P<rest>.+)$",
    re.IGNORECASE,
)

# A consolidated technical prompt pasted without a heading: a standalone
# long quoted paragraph at the end of the brief. Screenplays often end
# that way, and without this the block would stay glued to the last
# scene and apply to a single clip.
#
# The 200-character floor keeps a quoted lyric from being mistaken for
# the technical block; the explicit technical-prompt field remains the
# unambiguous way to say it.
_TRAILING_QUOTED_RE = re.compile(r'^[ \t]*["“].{200,}["”][ \t]*$', re.DOTALL)

# Quoted lyric / dialogue fragments inside a scene body.
_QUOTE_RE = re.compile(r"[\"“]([^\"”\n]{2,400})[\"”]")

# Headings that introduce the consolidated technical prompt block, e.g.
# "### **Prompt e Parâmetros Técnicos de Geração da IA:**". That block
# describes the whole film (fps, material, lighting, fade-out) and must
# not be mistaken for the body of the last scene.
_TECHNICAL_KEYWORDS = (
    "prompt",
    "parâmetros técnicos",
    "parametros tecnicos",
    "parâmetros técnicos",
    "technical",
    "instruções técnicas",
    "instrucoes tecnicas",
    "configuração técnica",
    "geracao da ia",
    "geração da ia",
)

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
class ScriptBeat:
    """A time-anchored sub-segment inside a scene.

    ``CENA 1 (0:00 - 0:11)`` may carry two beats: ``0:00 - 0:05`` and
    ``0:05 - 0:11``. They are the granularity that lets a shot line up
    with the exact second of the track it describes.
    """

    start: float
    end: float
    body: str
    body_plain: str
    quotes: list[str] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            "body": self.body,
            "body_plain": self.body_plain,
            "quotes": list(self.quotes),
        }


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
    #: The scene's own shot plan ("Visual: Plano macro ...").
    visual: str = ""
    #: Fine-grained, time-anchored sub-segments.
    beats: list[ScriptBeat] = field(default_factory=list)

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
            "visual": self.visual,
            "beats": [beat.to_dict() for beat in self.beats],
        }


@dataclass
class SceneScript:
    """The briefing split into a preamble plus an ordered scene list."""

    scenes: list[ScriptScene] = field(default_factory=list)
    global_style: str = ""
    #: The consolidated technical prompt block (fps, material, lighting,
    #: fade-out...). It describes the whole film, so it stays global
    #: instead of being appended to the last scene.
    global_technical: str = ""

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
            "global_technical": self.global_technical,
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
    title = re.sub(r"^[\s:|.\-–—]+", "", title)
    title = re.sub(r"[\s:.\-–—]+$", "", title)
    # Markdown emphasis left over from "**CENA 1: Title (0:00 - 0:11)**".
    title = title.strip("*_ ").strip()
    return title.strip()


def _clean_inline(text: str) -> str:
    """Drop the markdown emphasis markers that wrap a captured line.

    ``- **Visual:** Plano macro`` captures as ``"** Plano macro"`` because
    the closing ``**`` sits between the colon and the text.
    """
    out = str(text or "").strip()
    out = re.sub(r"^[*_]{1,3}[ \t]*", "", out)
    out = re.sub(r"[ \t]*[*_]{1,3}$", "", out)
    return out.strip()


def _is_technical_section(line: str) -> bool:
    """True when *line* introduces the consolidated technical prompt block.

    Only heading-shaped lines qualify, so a scene body mentioning
    "prompt" in prose never steals the block from the scene.
    """
    stripped = line.strip()
    if not stripped:
        return False
    heading_like = stripped.startswith("#") or (
        stripped.startswith("*") and stripped.endswith("*")
    )
    if not heading_like:
        return False
    lowered = stripped.lower()
    return any(keyword in lowered for keyword in _TECHNICAL_KEYWORDS)


def _parse_scene_body(lines: list[str]) -> dict[str, Any]:
    """Split a scene body into its shot plan, its beats and the rest.

    ``- **Visual:** Plano macro ...`` becomes the scene's shot plan;
    ``- **0:00 - 0:05:** ...`` lines become time-anchored beats; anything
    else stays in the residual body.
    """
    visual = ""
    beats: list[ScriptBeat] = []
    residual: list[str] = []
    residual_quotes: list[str] = []

    for line in lines:
        visual_match = _VISUAL_RE.match(line)
        if visual_match and not visual:
            visual = _clean_inline(visual_match.group("rest"))
            continue
        beat_match = _BEAT_RE.match(line)
        if beat_match:
            start = parse_timecode(beat_match.group("start"))
            end = parse_timecode(beat_match.group("end"))
            if start is not None and end is not None and end > start:
                raw = _clean_inline(beat_match.group("rest"))
                body_plain, quotes = _strip_quotes(raw)
                beats.append(ScriptBeat(
                    start=float(start),
                    end=float(end),
                    body=raw,
                    body_plain=body_plain,
                    quotes=quotes,
                ))
                continue
        residual.append(line)

    residual_text = "\n".join(residual).strip()
    residual_plain, residual_quotes = _strip_quotes(residual_text)

    return {
        "visual": visual,
        "beats": beats,
        "residual": residual_plain,
        "residual_quotes": residual_quotes,
    }


def parse_scene_script(text: str) -> SceneScript:
    """Split a Director briefing into preamble + time-anchored scenes.

    The briefing is expected to look like a screenplay: a global style
    block, then ``CENA N: Title (0:00 - 0:11)`` sections, optionally with
    a per-scene ``Visual:`` shot plan and ``0:00 - 0:05`` sub-beats, and
    finally a consolidated technical-prompt block.

    Unparseable briefings still return a usable result: the whole text
    becomes the preamble and no scene is anchored, which keeps the
    existing "global concept only" behaviour intact.
    """
    source = str(text or "")
    if not source.strip():
        return SceneScript(scenes=[], global_style="")

    lines = source.splitlines()
    preamble: list[str] = []
    technical: list[str] = []
    scenes: list[ScriptScene] = []
    current: Optional[dict[str, Any]] = None
    in_technical = False

    def _flush() -> None:
        nonlocal current
        if current is None:
            return
        raw_lines = current.pop("lines")
        parsed = _parse_scene_body(raw_lines)
        body = "\n".join(raw_lines).strip()
        quotes = list(parsed["residual_quotes"])
        for beat in parsed["beats"]:
            quotes.extend(beat.quotes)
        start = current["start"]
        end = current["end"]
        beats = parsed["beats"]
        if (start is None or end is None) and beats:
            # A scene header without a range still gets its window from
            # its own beats.
            start = min(beat.start for beat in beats)
            end = max(beat.end for beat in beats)
        scenes.append(ScriptScene(
            index=int(current["num"]),
            title=current["title"],
            start=start,
            end=end,
            body=body,
            body_plain=parsed["residual"],
            quotes=quotes,
            visual=parsed["visual"],
            beats=beats,
        ))
        current = None

    for raw_line in lines:
        if _ACT_HEADER_RE.match(raw_line):
            # Act headings and their following overview ranges are metadata,
            # never sub-beats of the scene that precedes the act.
            _flush()
            in_technical = False
            preamble.append(raw_line)
            continue
        if _is_technical_section(raw_line) and not _HEADER_RE.match(raw_line):
            # The technical block describes the whole film: flush the
            # scene in progress and collect the rest as a global block.
            _flush()
            in_technical = True
            technical.append(raw_line)
            continue

        header = _HEADER_RE.match(raw_line)
        if not header:
            if in_technical:
                technical.append(raw_line)
            elif current is not None:
                current["lines"].append(raw_line)
            else:
                preamble.append(raw_line)
            continue

        rest = header.group("rest") or ""
        range_match = _RANGE_RE.search(rest) or _HEADER_CLOCK_RANGE_RE.search(rest)
        start: Optional[float] = None
        end: Optional[float] = None
        title_text = rest
        if range_match:
            start = parse_timecode(range_match.group("start"))
            end = parse_timecode(range_match.group("end"))
            # A range that ends before it starts, or that has no length,
            # describes no moment of the track. Keeping it would make the
            # covered span inverted and break every clip binding.
            if start is None or end is None or end <= start:
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
    global_technical = "\n".join(technical).strip()

    # A brief that ends with the consolidated technical prompt but no
    # heading leaves that block glued to the last scene, where it would
    # apply to a single clip instead of the whole film. The signature is
    # a standalone long quoted paragraph.
    if scenes and not global_technical:
        last = scenes[-1]
        paragraphs = [p.strip() for p in last.body_plain.split("\n\n") if p.strip()]
        if paragraphs and _TRAILING_QUOTED_RE.match(paragraphs[-1]):
            last.body_plain = "\n\n".join(paragraphs[:-1]).strip()
            global_technical = paragraphs[-1]

    if not global_style and scenes and not any(scene.anchored for scene in scenes):
        # A briefing made only of unanchored scene headers still deserves a
        # readable concept; fall back to the raw titles.
        global_style = "; ".join(scene.title for scene in scenes if scene.title)

    return SceneScript(
        scenes=scenes,
        global_style=global_style,
        global_technical=global_technical,
    )


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
    return {
        "scenes": [],
        "global_style": "",
        "global_technical": "",
        "span": None,
        "anchored": False,
    }


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


def beats_overlapping(
    scene: Any,
    start: float,
    end: float,
) -> list[dict[str, Any]]:
    """Return the sub-beats of *scene* that overlap ``[start, end]``.

    Beats are the fine-grained anchors of a scripted scene. Binding a
    clip to the beats it actually covers is what lets a shot line up
    with the exact second of the track it describes.
    """
    if isinstance(scene, ScriptScene):
        beats = [beat.to_dict() for beat in scene.beats]
    elif isinstance(scene, dict):
        beats = scene.get("beats") or []
    else:
        return []
    try:
        low = float(start)
        high = float(end)
    except (TypeError, ValueError):
        return []
    matched: list[dict[str, Any]] = []
    for beat in beats:
        if not isinstance(beat, dict):
            continue
        beat_start = beat.get("start")
        beat_end = beat.get("end")
        if beat_start is None or beat_end is None:
            continue
        try:
            beat_start = float(beat_start)
            beat_end = float(beat_end)
        except (TypeError, ValueError):
            continue
        if beat_start < high and beat_end > low:
            matched.append(beat)
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
    if duration is not None and duration <= 0:
        # A non-positive length describes no track: treat it as unknown
        # rather than reporting a negative coverage.
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
