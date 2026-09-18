"""Director cinema-evaluator endpoint extracted as a third cut.

This module owns ``POST /api/v1/director/cinema/evaluate``. The cinema
pass is purely advisory: it scans a shot's textual fields (scene goal,
environment, lighting, wardrobe, props) and returns any era / lighting /
anachronism warnings the rules engine raised. The pass never blocks
generation; the response is consumed by the Director dashboard and the
prompt-editor UI.

Why a separate module
---------------------
The endpoint:

* has zero per-request state — every call is a pure function of the
  input JSON, so it can sit on its own ``APIRouter``;
* imports ``services.director.cinema`` which is 1.5MB of pure logic;
  keeping it on a side router lets the rest of the app load without
  paying the import cost;
* is small enough to cover with a tight test surface.

The cinema package itself (``services.director.cinema``) and its
``Severity`` enum are imported lazily inside the handler so the cold
boot cost stays zero.

Mounting in launch.py::

    from services.director.http_cinema import build_cinema_router
    api.include_router(build_cinema_router())
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request


logger = logging.getLogger(__name__)


async def _read_json_body(request: Request) -> dict[str, Any]:
    """Best-effort JSON body reader.

    Tolerates empty bodies (used for some legacy clients) and
    non-JSON content types by returning an empty dict; the route
    handler then validates the shape.
    """

    if not request.headers.get("content-type", "").startswith("application/json"):
        return {}
    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc
    return payload if isinstance(payload, dict) else {}


def build_cinema_router() -> APIRouter:
    """Build the cinema sub-router."""

    router = APIRouter(prefix="/api/v1/director/cinema", tags=["director-cinema"])

    @router.post("/evaluate")
    async def cinema_evaluate(request: Request) -> dict[str, Any]:
        """Run the cinema-rules pass on a shot's textual fields."""

        body = await _read_json_body(request)
        props = body.get("props") or []
        if not isinstance(props, list):
            raise HTTPException(status_code=400, detail="props must be a list of strings")

        try:
            from services.director.cinema import Severity, evaluate_shot
            from services.director.cinema.era import detect_era

            result = evaluate_shot(
                scene_goal=str(body.get("scene_goal", "") or ""),
                environment=str(body.get("environment", "") or ""),
                lighting=str(body.get("lighting", "") or ""),
                wardrobe=str(body.get("wardrobe", "") or ""),
                props=tuple(str(p) for p in props),
            )
            era = detect_era(
                scene_goal=str(body.get("scene_goal", "") or ""),
                environment=str(body.get("environment", "") or ""),
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("[cinema] evaluate failed")
            raise HTTPException(status_code=500, detail=f"cinema evaluation failed: {exc}") from exc

        hits = [
            {
                "rule_id": h.rule_id,
                "severity": h.severity.value if isinstance(h.severity, Severity) else str(h.severity),
                "message": h.message,
                "field": h.field,
                "suggestion": h.suggestion,
            }
            for h in result.hits
        ]
        return {
            "warnings": list(result.warnings),
            "hits": hits,
            "era": era.era.value,
        }

    return router


__all__ = ["build_cinema_router"]


def _auto_mount() -> None:
    """Auto-mount the router on the launch.py ``api`` singleton.

    Mirrors the pattern used by ``http_plans`` — keeps the cut purely
    additive. If launch.py hasn't been imported yet the import is a
    no-op; operators can wire the router manually with
    ``build_cinema_router`` when bootstrapping tests.
    """

    try:
        from launch import api as _api
    except ImportError:
        return
    try:
        _api.include_router(build_cinema_router())
    except Exception:  # noqa: BLE001
        # The router may already be mounted during a hot-reload; that's
        # fine. Anything else would surface during launch anyway.
        pass


_auto_mount()
