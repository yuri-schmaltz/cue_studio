"""Router de capacidades (A34 / R04).

Expõe ``GET /api/v1/capabilities/models`` e
``GET /api/v1/capabilities/models/{model_id}`` consultando o
``CapabilityMatrix`` do serviço.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from services.capability_matrix import (
    Capability,
    CapabilityEntry,
    CapabilityMatrix,
    Runtime,
    get_capability_matrix,
)

router = APIRouter(prefix="/api/v1/capabilities", tags=["capabilities"])


def _entry_to_dict(e: CapabilityEntry) -> dict[str, Any]:
    return {
        "model_id": e.model_id,
        "runtime": e.runtime.value,
        "mode": e.mode,
        "capabilities": sorted(c.value for c in e.capabilities),
    }


@router.get("/models")
def list_models(
    capability: str | None = Query(default=None, description="Filtrar por capacidade"),
) -> dict[str, Any]:
    matrix = get_capability_matrix()
    if capability:
        try:
            cap = Capability(capability)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"unknown capability: {capability}")
        entries = matrix.filter_by_capability(cap)
    else:
        entries = matrix.entries
    return {
        "count": len(entries),
        "entries": [_entry_to_dict(e) for e in entries],
    }


@router.get("/models/{model_id}")
def get_model(model_id: str) -> dict[str, Any]:
    matrix = get_capability_matrix()
    entries = matrix.for_model(model_id)
    if not entries:
        raise HTTPException(status_code=404, detail=f"unknown model: {model_id}")
    return {
        "model_id": model_id,
        "entries": [_entry_to_dict(e) for e in entries],
        "capabilities": sorted(
            {c.value for e in entries for c in e.capabilities}
        ),
    }


@router.get("/check")
def check_capability(
    model_id: str = Query(...),
    runtime: str = Query(...),
    mode: str = Query(...),
    capability: str = Query(...),
) -> dict[str, Any]:
    matrix = get_capability_matrix()
    try:
        rt = Runtime(runtime)
        cap = Capability(capability)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    ok = matrix.check(model_id, rt, mode, cap)
    return {
        "model_id": model_id,
        "runtime": runtime,
        "mode": mode,
        "capability": capability,
        "supported": ok,
    }


def build_capabilities_router() -> APIRouter:
    return router
