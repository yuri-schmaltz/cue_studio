"""FastAPI router for the Wizard agent (/api/v1/wizard/*).

Read endpoints (always available):

  GET  /api/v1/wizard/workflows              → list workflows
  GET  /api/v1/wizard/workflows/{id}         → one workflow

Write endpoints (drive the supervisor):

  POST /api/v1/wizard/workflows              → create a workflow
  POST /api/v1/wizard/workflows/{id}/steps   → add a step
  POST /api/v1/wizard/workflows/{id}/run     → run one step
  POST /api/v1/wizard/workflows/{id}/run-all → run all pending steps
  DELETE /api/v1/wizard/workflows/{id}       → delete

Phase C of the HocusPocus migration. Mutations are gated by capability
checks in a follow-up release (see docs/MIGRATION_HOCUSPOCUS.md).
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from fastapi import APIRouter, HTTPException, Query, Request

# Dual-context import (same pattern as routers/mcp.py and routers/productions.py)
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
    "wf": _resolve("app.services.wizard_workflows", "services.wizard_workflows"),
    "sup": _resolve("app.services.wizard_supervisor", "services.wizard_supervisor"),
}


WizardWorkflowStore = _modules["wf"].WizardWorkflowStore
WizardSupervisor = _modules["sup"].WizardSupervisor


_log = logging.getLogger("cue_studio.wizard.router")


def _build_router(
    store: WizardWorkflowStore | None = None,
    supervisor: WizardSupervisor | None = None,
) -> APIRouter:
    """Build the wizard router. Tests inject store + supervisor; launch.py uses defaults."""
    router = APIRouter()
    store = store or WizardWorkflowStore()
    supervisor = supervisor or WizardSupervisor(store=store)

    @router.get("/api/v1/wizard/workflows")
    async def list_workflows(
        limit: int = Query(default=50, ge=1, le=100),
    ) -> dict[str, Any]:
        return {"count": len(store.list(limit=limit)), "workflows": store.list(limit=limit)}

    @router.get("/api/v1/wizard/workflows/{workflow_id}")
    async def get_workflow(workflow_id: str) -> dict[str, Any]:
        workflow = store.get(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return workflow

    @router.post("/api/v1/wizard/workflows")
    async def create_workflow(request: Request) -> dict[str, Any]:
        body = await _read_body(request)
        if not body:
            raise HTTPException(status_code=400, detail="Empty body")
        workflow = store.upsert(body)
        return workflow

    @router.post("/api/v1/wizard/workflows/{workflow_id}/steps")
    async def add_step(workflow_id: str, request: Request) -> dict[str, Any]:
        body = await _read_body(request)
        if not isinstance(body.get("name"), str) or not body.get("name"):
            raise HTTPException(status_code=400, detail="'name' is required")
        workflow = store.get(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        new_step = {
            "name": body["name"],
            "state": "pending",
            "input": body.get("input"),
        }
        steps = list(workflow.get("steps") or [])
        steps.append(new_step)
        updated = dict(workflow)
        updated["steps"] = steps
        return store.upsert(updated)

    @router.post("/api/v1/wizard/workflows/{workflow_id}/run")
    async def run_step(
        workflow_id: str,
        request: Request,
    ) -> dict[str, Any]:
        body = await _read_body(request)
        step_name = body.get("step_name") or body.get("name")
        try:
            result = supervisor.run_step(workflow_id, step_name=step_name)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return result.to_dict()

    @router.post("/api/v1/wizard/workflows/{workflow_id}/run-all")
    async def run_all(
        workflow_id: str,
        max_steps: int = Query(default=32, ge=1, le=200),
    ) -> dict[str, Any]:
        results = supervisor.run_all(workflow_id, max_steps=max_steps)
        return {
            "count": len(results),
            "results": [r.to_dict() for r in results],
        }

    @router.delete("/api/v1/wizard/workflows/{workflow_id}")
    async def delete_workflow(workflow_id: str) -> dict[str, Any]:
        deleted = store.delete(workflow_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return {"deleted": True, "workflow_id": workflow_id}

    return router


async def _read_body(request: Request) -> dict:
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
    return parsed if isinstance(parsed, dict) else {}


def build_wizard_router(
    store: WizardWorkflowStore | None = None,
    supervisor: WizardSupervisor | None = None,
) -> APIRouter:
    """Public factory: returns a router ready for ``api.include_router(...)``."""
    return _build_router(store=store, supervisor=supervisor)
