"""FastAPI router exposing Production Run operations (/api/v1/productions).

Read endpoints (always available):

  GET  /api/v1/productions                  → list productions (optional ?status=)
  GET  /api/v1/productions/{id}             → one production + its runs
  GET  /api/v1/productions/{id}/runs        → all runs for a production
  GET  /api/v1/productions/{id}/events      → audit events

Write endpoints (delegated to director_pipeline):

  POST /api/v1/productions/{id}/resume      → resume a crashed pipeline
  POST /api/v1/productions/{id}/retake      → retake one stage

The router does NOT register itself with the live FastAPI app — that
happens via ``api.include_router(build_productions_router())`` from
``launch.py``, matching the existing pattern used by the MCP router.
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from fastapi import APIRouter, HTTPException, Query, Request

# Use the same dual-context import trick as routers/mcp.py so launch.py
# and pytest share the ProductionStore singleton.
import importlib
import importlib.util
import sys


def _resolve(short: str, full: str):
    for name in (full, short):
        if name in sys.modules:
            return sys.modules[name]
    for full_name in (full, short):
        spec = importlib.util.find_spec(full_name)
        if spec is not None:
            return importlib.import_module(full_name)
    raise ImportError(f"Cannot resolve {short}")


_modules = {
    "store": _resolve("app.services.production_store", "services.production_store"),
    "resume": _resolve("app.services.production_resume", "services.production_resume"),
}


ProductionStore = _modules["store"].ProductionStore
ProductionResume = _modules["resume"].ProductionResume


_log = logging.getLogger("cue_studio.productions.router")


def _build_router(store: ProductionStore | None = None) -> APIRouter:
    """Build the productions router.

    Parameters
    ----------
    store:
        Optional :class:`ProductionStore` instance. Defaults to a fresh
        store on the project's default DB path. Tests inject their own
        store via this parameter; ``launch.py`` relies on the default.
    """
    router = APIRouter()

    facade = ProductionResume(store=store or ProductionStore())

    # ---------------------------------------------------------------- list
    @router.get("/api/v1/productions")
    async def list_productions(
        status: str | None = Query(default=None, max_length=32),
        limit: int = Query(default=50, ge=1, le=500),
    ) -> dict[str, Any]:
        productions = facade._store.list_productions(status=status, limit=limit)
        return {"count": len(productions), "productions": productions}

    # ---------------------------------------------------- single + cascade
    @router.get("/api/v1/productions/{production_id}")
    async def get_production(production_id: str) -> dict[str, Any]:
        production = facade._store.get_production(production_id)
        if production is None:
            raise HTTPException(status_code=404, detail="Production not found")
        runs = facade._store.list_runs(production_id)
        return {"production": production, "runs": runs}

    @router.get("/api/v1/productions/{production_id}/runs")
    async def list_runs(production_id: str) -> dict[str, Any]:
        runs = facade._store.list_runs(production_id)
        return {"production_id": production_id, "count": len(runs), "runs": runs}

    @router.get("/api/v1/productions/{production_id}/events")
    async def list_events(
        production_id: str,
        limit: int = Query(default=100, ge=1, le=1000),
    ) -> dict[str, Any]:
        events = facade._store.list_events(production_id=production_id, limit=limit)
        return {
            "production_id": production_id,
            "count": len(events),
            "events": events,
        }

    # -------------------------------------------------------------- writes
    @router.post("/api/v1/productions/{production_id}/resume")
    async def resume_production(
        production_id: str,
        request: Request,
    ) -> dict[str, Any]:
        body = await _read_json_body(request)
        out_dir = body.get("out_dir") or body.get("workspace") or "default"
        result = facade.resume_production(pipeline_id=production_id, out_dir=out_dir)
        return result.to_dict()

    @router.post("/api/v1/productions/{production_id}/retake")
    async def retake_stage(
        production_id: str,
        request: Request,
    ) -> dict[str, Any]:
        body = await _read_json_body(request)
        out_dir = body.get("out_dir") or body.get("workspace") or "default"
        stage_name = body.get("stage") or body.get("stage_name") or ""
        if not stage_name:
            raise HTTPException(status_code=400, detail="'stage' is required")
        result = facade.retake_stage(
            pipeline_id=production_id, out_dir=out_dir, stage_name=stage_name,
        )
        return result.to_dict()

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


def build_productions_router(store: ProductionStore | None = None) -> APIRouter:
    """Public factory: returns a router ready for ``api.include_router(...)``."""
    return _build_router(store=store)
