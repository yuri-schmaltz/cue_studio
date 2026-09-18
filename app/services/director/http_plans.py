"""Director plan-and-prompt endpoints extracted as a second cut.

Why this is a separate module
-----------------------------
The original ``director/http.py`` cut moved only the registry catalog
because the rest of the Director endpoints touch the per-request
generation state. After auditing the surface we found a clean subset
that doesn't depend on the request-scoped model cache or the LLM
loader:

* ``POST /director/plan-prompts`` — text-only LLM call to draft image
  prompts from a structured prompt dictionary. No GPU, no
  ``_jobs`` registry.
* ``POST /director/plan-angle-prompts`` — sibling call that rewrites
  the same plan with explicit camera angles.
* ``POST /director/generate-negative-prompt`` — text-only LLM call
  that produces a negative prompt given a scene and optional style
  bible context.

These three endpoints all live behind a tiny "LLM-backed text
generation" abstraction and benefit from being in their own module:

* shared system-prompt templates,
* shared ``AbortSignal`` plumbing,
* a single ``PLAN_TIMEOUT_SECONDS`` ceiling so a slow LLM provider
  can't tie up a worker indefinitely,
* one place to add OpenTelemetry tracing later.

Mounting in launch.py::

    from services.director.http_plans import build_plans_router
    api.include_router(build_plans_router())
"""

from __future__ import annotations

import inspect
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request


logger = logging.getLogger(__name__)


PLAN_TIMEOUT_SECONDS = 90


def _extract_abort_signal(request: Request) -> Any | None:
    """Pull the optional ``AbortSignal`` off the FastAPI request.

    The frontend creates an ``AbortController`` for long-running
    Director actions and passes the signal in a custom header so the
    backend can interrupt the LLM call. The header name is centralised
    here so the rest of the Director codebase uses the same value.
    """

    return getattr(request.state, "abort_signal", None)


async def _read_json_body(request: Request) -> dict[str, Any]:
    try:
        return await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc


async def _maybe_await(value: Any) -> Any:
    """Await the value if it is awaitable, otherwise return it directly.

    Lets the router accept either synchronous helpers (today's
    ``prompt_polish`` use case) or async helpers (a future migration
    target) without changing the call site.
    """

    if inspect.isawaitable(value):
        return await value
    return value


def build_plans_router() -> APIRouter:
    """Build the Director plan/prompt sub-router."""

    router = APIRouter(prefix="/api/v1/director", tags=["director-plans"])

    @router.post("/plan-prompts")
    async def plan_prompts(request: Request) -> dict[str, Any]:
        """Draft one image prompt per clip from a structured input."""

        body = await _read_json_body(request)
        skill = str(body.get("skill") or "")
        scene_description = str(body.get("scene_description") or "")
        plan_inputs = body.get("plan_inputs") or []
        style_bibles = body.get("style_bibles") or []
        try:
            # Lazy import: the actual generator pulls in the multi-MB
            # director module only when this endpoint is invoked.
            from services.director import prompt_polish as _pp
            return await _maybe_await(_pp.plan_prompts(
                skill=skill,
                scene_description=scene_description,
                plan_inputs=plan_inputs,
                style_bibles=style_bibles,
                abort_signal=_extract_abort_signal(request),
                timeout=PLAN_TIMEOUT_SECONDS,
            ))
        except TimeoutError as exc:
            raise HTTPException(status_code=504, detail=f"LLM call timed out: {exc}") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/plan-angle-prompts")
    async def plan_angle_prompts(request: Request) -> dict[str, Any]:
        """Rewrite the same plan with explicit camera-angle instructions."""

        body = await _read_json_body(request)
        plan_inputs = body.get("plan_inputs") or []
        style_bibles = body.get("style_bibles") or []
        try:
            from services.director import prompt_polish as _pp
            return await _maybe_await(_pp.plan_angle_prompts(
                plan_inputs=plan_inputs,
                style_bibles=style_bibles,
                abort_signal=_extract_abort_signal(request),
                timeout=PLAN_TIMEOUT_SECONDS,
            ))
        except TimeoutError as exc:
            raise HTTPException(status_code=504, detail=f"LLM call timed out: {exc}") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/generate-negative-prompt")
    async def generate_negative_prompt(request: Request) -> dict[str, Any]:
        """Produce a negative prompt tailored to the current scene."""

        body = await _read_json_body(request)
        scene_description = str(body.get("scene_description") or "")
        style_bibles = body.get("style_bibles") or []
        lyrics_summary = body.get("lyrics_summary")
        try:
            from services.director import prompt_polish as _pp
            return await _maybe_await(_pp.generate_negative_prompt(
                scene_description=scene_description,
                style_bibles=style_bibles,
                lyrics_summary=lyrics_summary,
                abort_signal=_extract_abort_signal(request),
                timeout=PLAN_TIMEOUT_SECONDS,
            ))
        except TimeoutError as exc:
            raise HTTPException(status_code=504, detail=f"LLM call timed out: {exc}") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router


__all__ = ["PLAN_TIMEOUT_SECONDS", "build_plans_router"]
