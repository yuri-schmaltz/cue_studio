"""Router REST do Shot IR e do continuity check (A25).

Rotas (spec 31 seção 3.4):

  GET  /api/v1/director/productions/{id}/shots/{shot_id}/shot_ir
  PUT  /api/v1/director/productions/{id}/shots/{shot_id}/shot_ir
  GET  /api/v1/director/productions/{id}/continuity
  POST /api/v1/director/productions/{id}/continuity/check

Seguindo o padrão de ``routers/productions.py``: o router NÃO se registra
no app vivo — isso acontece via ``api.include_router(build_shot_ir_router(...))``
em ``launch.py``. O diretório-raiz dos projetos é injetado por
``projects_root`` para que ``launch.py`` resolva o mesmo caminho usado
pela UI e os testes injetem um ``tmp_path``.
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
import sys
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException

# Dual-context import trick (same as routers/productions.py): launch.py
# imports this module as `routers.shot_ir` while pytest imports it as
# `app.routers.shot_ir`; both must share one director services instance.
def _resolve(short: str, full: str):
    for name in (full, short):
        if name in sys.modules:
            return sys.modules[name]
    for full_name in (full, short):
        spec = importlib.util.find_spec(full_name)
        if spec is not None:
            return importlib.import_module(full_name)
    raise ImportError(f"Cannot resolve {short}")


_continuity_module = _resolve(
    "app.services.director.continuity_check", "services.director.continuity_check"
)
check_sequence = _continuity_module.check_sequence
severity_counts = _continuity_module.severity_counts

_schema_module = _resolve(
    "app.services.director.shot_ir_schema", "services.director.shot_ir_schema"
)
ShotIRValidationError = _schema_module.ShotIRValidationError
dict_to_shotir = _schema_module.dict_to_shotir
shotir_to_dict = _schema_module.shotir_to_dict

_store_module = _resolve(
    "app.services.director.shot_ir_store", "services.director.shot_ir_store"
)
ShotIRStore = _store_module.ShotIRStore
shots_dir_for = _store_module.shots_dir_for


_log = logging.getLogger("cue_studio.shot_ir.router")


def build_shot_ir_router(
    projects_root: Callable[[], str] | str | None = None,
) -> APIRouter:
    """Factory do router Shot IR.

    Parameters
    ----------
    projects_root:
        Raiz onde vivem os diretórios de produção. Pode ser string ou
        callable (``launch.py`` injeta ``_projects_root``); testes injetam
        um ``tmp_path``. Default resolve ``CUE_PROJECTS_ROOT`` ou ``outputs``.
    """
    router = APIRouter()

    def _root() -> Path:
        if callable(projects_root):
            return Path(projects_root())
        if projects_root:
            return Path(projects_root)
        import os

        return Path(os.environ.get("CUE_PROJECTS_ROOT") or "outputs")

    def _store(production_id: str) -> ShotIRStore:
        if not production_id or "/" in production_id or "\\" in production_id:
            raise HTTPException(status_code=400, detail="Invalid production id")
        return ShotIRStore(shots_dir_for(_root(), production_id))

    # ------------------------------------------------------------- read
    @router.get(
        "/api/v1/director/productions/{production_id}/shots/{shot_id}/shot_ir"
    )
    async def get_shot_ir(production_id: str, shot_id: str) -> dict[str, Any]:
        store = _store(production_id)
        shot = store.load_optional(shot_id)
        if shot is None:
            raise HTTPException(
                status_code=404,
                detail=f"Shot IR not found: {production_id}/{shot_id}",
            )
        return {"shot_id": shot_id, "shot_ir": shotir_to_dict(shot)}

    # ------------------------------------------------------------ write
    @router.put(
        "/api/v1/director/productions/{production_id}/shots/{shot_id}/shot_ir"
    )
    async def put_shot_ir(
        production_id: str, shot_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        store = _store(production_id)
        body = dict(payload or {})
        body.setdefault("shot_id", shot_id)
        try:
            shot = dict_to_shotir(body)
        except ShotIRValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        path = store.save(shot)
        return {"shot_id": shot_id, "saved": True, "path": str(path)}

    # ------------------------------------------------------- continuity
    def _run_continuity(production_id: str) -> dict[str, Any]:
        store = _store(production_id)
        shots = store.list_shots()
        findings = check_sequence(shots)
        return {
            "production_id": production_id,
            "shot_count": len(shots),
            "inconsistencies": [f.to_dict() for f in findings],
            "severity_counts": severity_counts(findings),
        }

    @router.get("/api/v1/director/productions/{production_id}/continuity")
    async def get_continuity(production_id: str) -> dict[str, Any]:
        return _run_continuity(production_id)

    @router.post(
        "/api/v1/director/productions/{production_id}/continuity/check"
    )
    async def post_continuity_check(production_id: str) -> dict[str, Any]:
        # Sem cache persistido: o "rerun" recomputa a mesma coisa de forma
        # determinística, mantendo o contrato de força-refresh da spec.
        return _run_continuity(production_id)

    return router


__all__ = ["build_shot_ir_router"]
