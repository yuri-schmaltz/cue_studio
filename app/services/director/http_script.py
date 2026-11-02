"""Director endpoint that reconciles a briefing against the real audio.

Why this exists
---------------
A Director briefing may describe only a slice of the uploaded track —
three scenes over 45 seconds of a 4:15 song. Before this endpoint the
Director had no way to *say* so: the clip planner always covered the
whole file, and the planner LLM received the briefing as one global
string. The result was a full-length music video whose extra shots were
invented from a script that never mentioned them.

``POST /api/v1/director/script-reconcile`` parses the briefing into a
time-anchored scene script and reports how much of the audio it actually
covers, so the UI can warn before the user spends GPU time on shots
they never asked for.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from .scene_script import parse_scene_script, reconcile_scene_script


logger = logging.getLogger(__name__)


def build_script_router() -> APIRouter:
    router = APIRouter(tags=["director"])

    @router.post("/api/v1/director/script-reconcile")
    async def script_reconcile(request: Request) -> dict[str, Any]:
        """Report how much of the audio a briefing actually covers.

        Body: ``scene_description`` (the briefing text) and optionally
        ``audio_duration`` (seconds) for the coverage ratio. The response
        carries the parsed scenes plus a report whose ``status`` is one of
        ``full_track``, ``excerpt`` or ``no_timecodes``.
        """

        try:
            body = await request.json()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="request body must be a JSON object")

        description = str(body.get("scene_description") or "")
        raw_duration = body.get("audio_duration")
        try:
            duration = float(raw_duration) if raw_duration is not None else None
        except (TypeError, ValueError):
            duration = None

        script = parse_scene_script(description)
        script_dict = script.to_dict()
        report = reconcile_scene_script(script_dict, duration)
        return {
            "script": script_dict,
            "report": report.to_dict(),
        }

    return router


__all__ = ["build_script_router"]
