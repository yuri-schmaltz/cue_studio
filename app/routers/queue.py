"""Queue router: post-restart job states + idempotent resume (A19).

Endpoints (namespace follows the real ``/api/v1`` convention; the spec's
``/api/queue`` prefix does not exist in this codebase):

  GET  /api/v1/queue                 → every persisted job with its
                                       post-restart state (done /
                                       interrupted / failed / unknown)
  POST /api/v1/queue/{job_id}/resume → resume an interrupted/failed job;
                                       idempotent via ``Idempotency-Key``

The router does NOT register itself with the live FastAPI app — that
happens via ``api.include_router(build_queue_router())`` from
``launch.py``, matching the pattern used by the productions router.
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
import sys
from fastapi import APIRouter, HTTPException, Query, Request

# Use the same dual-context import trick as routers/productions.py so
# launch.py (`routers.queue`) and pytest (`app.routers.queue`) share one
# module instance of the classifier service.
import importlib
import importlib.util
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any


def _resolve(short: str, full: str):
    for name in (full, short):
        if name in sys.modules:
            return sys.modules[name]
    for full_name in (full, short):
        spec = importlib.util.find_spec(full_name)
        if spec is not None:
            return importlib.import_module(full_name)
    raise ImportError(f"Cannot resolve {short}")


_classifier_module = _resolve(
    "app.services.job_classifier", "services.job_classifier"
)
UNKNOWN = _classifier_module.UNKNOWN
QueueResumeService = _classifier_module.QueueResumeService

_store_module = _resolve("app.services.production_store", "services.production_store")
ProductionStore = _store_module.ProductionStore

_log = logging.getLogger("cue_studio.queue.router")


def build_queue_router(
    store: Any | None = None,
    *,
    fs_root: Path | str | Callable[[], Path | str] | None = None,
    resume=None,
) -> APIRouter:
    """Build the queue router.

    Parameters
    ----------
    store:
        Optional :class:`ProductionStore` instance. Defaults to a store
        on the project's default DB path (resolved through
        ``APP_SQLITE_PATH`` / ``APP_CACHE_DIR`` — A06).
    fs_root:
        Root scanned for job media. Accepts a path or a zero-argument
        callable evaluated per request (``launch.py`` passes
        ``_projects_root``). Defaults to the current working directory.
    resume:
        Optional ``(pipeline_id, out_dir) -> result`` callable injected
        by tests; defaults to ``ProductionResume.resume_production``.
    """
    router = APIRouter()
    active_store = store or ProductionStore()

    # A19 boot recovery: flag runs that were live when the previous
    # process died. Idempotent — repeats never overwrite the first stamp.
    try:
        stamped = active_store.mark_all_interrupted()
        if stamped:
            _log.info("[queue] flagged %d interrupted run(s) from previous boot", stamped)
    except Exception:  # pragma: no cover - boot scan must not block the API
        _log.exception("[queue] interrupted-run boot scan failed")

    def _base_root() -> Path | str:
        if callable(fs_root):
            try:
                return fs_root()
            except Exception:  # pragma: no cover - defensive
                _log.exception("[queue] fs_root provider failed")
                return "."
        return fs_root if fs_root is not None else "."

    def _service() -> QueueResumeService:
        return QueueResumeService(active_store, fs_root=_base_root(), resume=resume)

    # ---------------------------------------------------------------- list
    @router.get("/api/v1/queue")
    async def queue_list(limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
        jobs = _service().list_jobs(limit=limit)
        return {"count": len(jobs), "jobs": jobs}

    # -------------------------------------------------------------- resume
    @router.post("/api/v1/queue/{job_id}/resume")
    async def queue_resume(job_id: str, request: Request) -> dict[str, Any]:
        body = await _read_json_body(request)
        out_dir = body.get("out_dir") or body.get("workspace") or "default"
        idempotency_key = (
            request.headers.get("Idempotency-Key")
            or body.get("idempotency_key")
            or None
        )
        result = _service().resume_job(
            job_id,
            out_dir=str(out_dir),
            idempotency_key=idempotency_key,
        )
        if not result["ok"] and result["status"] == UNKNOWN:
            raise HTTPException(status_code=404, detail=result["message"])
        return result

    return router


async def _read_json_body(request: Request) -> Mapping[str, Any]:
    """Read a JSON body without raising on empty bodies."""
    try:
        raw = await request.body()
    except Exception:
        return {}
    if not raw:
        return {}
    import json

    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, Mapping) else {}


__all__ = ["build_queue_router"]
