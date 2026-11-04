"""Director pre-flight endpoint: price a project before it is queued.

``POST /api/v1/director/preflight`` answers the question a Director user
actually has before pressing *Generate Videos*: how many shots will this
become, how long will it take, and will it fit in this machine's VRAM?

The heavy lifting lives in :mod:`services.director.preflight`; this
module only translates HTTP into that service's arguments.  The service
is handed every fact it needs through :class:`DirectorPreflightDeps`, so
the endpoint can be exercised without loading the engine.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional

from fastapi import APIRouter, HTTPException, Request

from ..director_video_strategy import build_director_video_execution_profile
from .preflight import build_preflight_report

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DirectorPreflightDeps:
    """Everything the endpoint needs from the running server."""

    #: Detected hardware of this machine (GPU name, VRAM, RAM, ...).
    hardware: Callable[[], Mapping[str, Any]]
    #: The machine's local timing history, if it has one.
    eta_history: Callable[[], Any]
    #: The video model's definition (fps, frame lattice, memory policy).
    model_def: Callable[[str], Mapping[str, Any] | None]
    #: ``(frames_minimum, frames_steps, latent_size)`` for a model.
    model_geometry: Callable[[str], tuple[int, int, int]]
    #: The model's default settings (native window length, overlap).
    default_settings: Callable[[str], Mapping[str, Any] | None]


def _as_list(value: Any) -> list[str]:
    if value in (None, "", False):
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if str(item or "").strip()]
    return [str(value)]


def build_preflight_router(deps: DirectorPreflightDeps) -> APIRouter:
    router = APIRouter(tags=["director"])

    @router.post("/api/v1/director/preflight")
    async def director_preflight(request: Request) -> dict[str, Any]:
        """Estimate the cost of a Director plan.

        Body: the planned shots (``planned_clips`` with ``start``/``end``
        in seconds), the selected ``video_model`` and the video settings
        that would be submitted with the render.  The response reports
        the clip count, the total footage, a wall-clock estimate, the
        VRAM/OOM risk and concrete warnings.
        """

        try:
            body = await request.json()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=400, detail=f"Invalid JSON body: {exc}"
            ) from exc
        if not isinstance(body, dict):
            raise HTTPException(
                status_code=400, detail="request body must be a JSON object"
            )

        video_model = str(body.get("video_model") or "").strip()
        if not video_model:
            raise HTTPException(
                status_code=400, detail="video_model is required"
            )

        planned_clips = body.get("planned_clips")
        if not isinstance(planned_clips, list):
            planned_clips = []

        try:
            model_def = deps.model_def(video_model) or {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Director pre-flight could not resolve %s: %s", video_model, exc)
            model_def = {}
        try:
            frames_minimum, frames_steps, latent_size = deps.model_geometry(
                video_model
            )
        except Exception:  # noqa: BLE001
            frames_minimum, frames_steps, latent_size = 1, 1, 1
        try:
            default_settings = deps.default_settings(video_model) or {}
        except Exception:  # noqa: BLE001
            default_settings = {}

        video_params = body.get("video_params")
        video_params = dict(video_params) if isinstance(video_params, Mapping) else {}
        resolution = str(
            video_params.get("resolution") or body.get("resolution") or ""
        ).strip()
        if resolution:
            video_params["resolution"] = resolution

        steps = body.get("num_inference_steps")
        if steps is None:
            steps = video_params.get("num_inference_steps")
        try:
            steps = int(steps)
        except (TypeError, ValueError):
            steps = 8

        fps = body.get("fps")
        if fps is None:
            fps = video_params.get("fps")
        try:
            fps_value = float(fps)
        except (TypeError, ValueError):
            fps_value = 0.0
        if fps_value <= 0:
            try:
                fps_value = float(model_def.get("fps") or 0)
            except (TypeError, ValueError):
                fps_value = 0.0
        if fps_value <= 0:
            fps_value = 25.0

        hardware = {}
        try:
            hardware = dict(deps.hardware() or {})
        except Exception as exc:  # noqa: BLE001
            logger.warning("Director pre-flight could not read the hardware: %s", exc)

        execution_profile = None
        execution_profile_error = ""
        try:
            execution_profile = build_director_video_execution_profile(
                video_model,
                model_def,
                video_params,
                hardware,
                manual_max_frames=body.get("manual_max_frames"),
            )
        except ValueError as exc:
            execution_profile_error = str(exc)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Director pre-flight could not build the execution profile: %s", exc
            )

        eta_history = None
        try:
            eta_history = deps.eta_history()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Director pre-flight could not open the ETA history: %s", exc)

        report = build_preflight_report(
            planned_clips=planned_clips,
            video_model=video_model,
            resolution=resolution,
            num_inference_steps=steps,
            fps=fps_value,
            frames_minimum=frames_minimum,
            latent_size=latent_size,
            window_overlap=int(video_params.get("sliding_window_overlap") or 0),
            has_audio_guide=bool(body.get("has_audio_guide")),
            has_start_images=bool(body.get("has_start_images")),
            has_end_images=bool(body.get("has_end_images")),
            activated_loras=_as_list(
                video_params.get("activated_loras")
                or body.get("activated_loras")
            ),
            loras_multipliers=str(
                video_params.get("loras_multipliers")
                or body.get("loras_multipliers")
                or ""
            ),
            eta_history=eta_history,
            hardware=hardware,
            execution_profile=execution_profile,
            execution_profile_error=execution_profile_error,
            memory_policy=(
                model_def.get("director_memory_policy")
                or model_def.get("sliding_window_memory_policy")
            ),
            model_def=model_def,
            default_settings=default_settings,
        )
        report["execution_profile_error"] = execution_profile_error
        return report

    return router


__all__ = ["DirectorPreflightDeps", "build_preflight_router"]
