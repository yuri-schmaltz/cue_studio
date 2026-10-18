"""Router REST do cross-family continuity (A25b / R10).

Rotas (spec 41 seção 3.5):

  GET /api/v1/director/continuity/resolve
  GET /api/v1/director/continuity/adapters
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Query

# Dual-context import trick (mesmo padrão de routers/shot_ir.py).
def _resolve(short: str, full: str):
    for name in (full, short):
        if name in sys.modules:
            return sys.modules[name]
    for full_name in (full, short):
        spec = importlib.util.find_spec(full_name)
        if spec is not None:
            return importlib.import_module(full_name)
    raise ImportError(f"Cannot resolve {short}")


_cf_module = _resolve(
    "app.services.cross_family_continuity", "services.cross_family_continuity"
)
ModelFamily = _cf_module.ModelFamily
PreviousShotOutput = _cf_module.PreviousShotOutput
ContinuationStrategy = _cf_module.ContinuationStrategy
create_default_registry = _cf_module.create_default_registry
resolve_continuity = _cf_module.resolve_continuity
detect_family = _cf_module.detect_family


def build_continuity_router(
    projects_root: Callable[[], str] | str | None = None,
) -> APIRouter:
    router = APIRouter()

    def _root() -> Path:
        if callable(projects_root):
            return Path(projects_root())
        if projects_root:
            return Path(projects_root)
        import os

        return Path(os.environ.get("CUE_PROJECTS_ROOT") or "outputs")

    @router.get("/api/v1/director/continuity/adapters")
    def list_adapters() -> dict[str, Any]:
        reg = create_default_registry()
        return {
            "count": len(reg.available_families()),
            "adapters": [f.value for f in reg.available_families()],
        }

    @router.get("/api/v1/director/continuity/resolve")
    def resolve(
        model_id: str = Query(..., description="ID do modelo"),
        previous_shot_id: str = Query(default="shot_prev"),
        picture_n_index: int | None = Query(default=None),
        last_frame_path: str | None = Query(default=None),
    ) -> dict[str, Any]:
        reg = create_default_registry()
        prev = PreviousShotOutput(
            shot_id=previous_shot_id,
            picture_n_index=picture_n_index,
            last_frame_path=last_frame_path,
        )
        strategy = resolve_continuity(model_id=model_id, previous_output=prev, registry=reg)
        return {
            "model_id": model_id,
            "mode": strategy.mode,
            "confidence": strategy.confidence,
            "adapter_family": strategy.adapter_family.value,
            "payload": strategy.payload,
            "notes": list(strategy.notes),
        }

    return router


__all__ = ["build_continuity_router"]
"""<|end|><|start|>assist<|channel|>analysis<|message|>Create alias router file for cross_family_continuity name.<|end|><|start|><|start|>assistant to=write<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
/home/yuri/Documentos/cine_local/cue_studio/app/routers/cross_family_continuity.py
build_cross_family_continuity_router = build_continuity_router
