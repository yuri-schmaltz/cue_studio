"""Router REST da CapabilityMatrix (A34 / R04).

Rotas (spec 37 §5):

  GET /api/v1/capabilities/models
  GET /api/v1/capabilities/models/{model_id}/runtimes
  GET /api/v1/capabilities/check?model=X&runtime=Y&mode=Z&cap=W

Opcionalmente cruza a matriz com o catálogo real de modelos instalados
(``models_fetcher`` injetado por ``launch.py``) para expor ``in_catalog``
por modelo — capacidade declarada para modelo ausente do catálogo fica
visível para a UI (spec §2.1: "matriz declarada vs runtime real").
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
import sys
from typing import Any, Callable, Iterable

from fastapi import APIRouter, HTTPException, Query

# Dual-context import trick (routers/productions.py)
def _resolve(short: str, full: str):
    for name in (full, short):
        if name in sys.modules:
            return sys.modules[name]
    for full_name in (full, short):
        spec = importlib.util.find_spec(full_name)
        if spec is not None:
            return importlib.import_module(full_name)
    raise ImportError(f"Cannot resolve {short}")


_matrix_module = _resolve(
    "app.services.capability_matrix", "services.capability_matrix"
)
Capability = _matrix_module.Capability
Runtime = _matrix_module.Runtime
get_capability_matrix = _matrix_module.get_capability_matrix


_log = logging.getLogger("cue_studio.capabilities.router")


def _installed_model_ids(models_payload: Any) -> set[str]:
    """Extrai os ``model_type`` de payloads variados do catálogo.

    Aceita lista de dicts, ``{"models": [...]}`` ou resposta FastAPI com
    atributo ``body``/``json`` — o fetcher injetado pode devolver qualquer
    um dos formatos usados por ``/api/v1/models`` ao longo do tempo.
    """
    if hasattr(models_payload, "body"):
        try:
            import json

            models_payload = json.loads(models_payload.body)
        except Exception:
            models_payload = None
    if isinstance(models_payload, dict):
        models_payload = models_payload.get("models") or models_payload.get("model_types") or []
    ids: set[str] = set()
    if isinstance(models_payload, (list, tuple)):
        for item in models_payload:
            if isinstance(item, str):
                ids.add(item)
            elif isinstance(item, dict):
                value = item.get("model_type") or item.get("id") or item.get("model_id")
                if value:
                    ids.add(str(value))
    return ids


def build_capabilities_router(
    models_fetcher: Callable[[], Any] | None = None,
    *,
    matrix_provider: Callable[[], Any] | None = None,
) -> APIRouter:
    """Factory do router de capabilities.

    Parameters
    ----------
    models_fetcher:
        Opcional; devolve o payload do catálogo de modelos instalados
        (``launch.py`` injeta um fetcher de ``/api/v1/models``). Quando
        ausente, ``in_catalog`` não é informado.
    matrix_provider:
        Opcional; devolve a :class:`CapabilityMatrix` atual. Default usa o
        singleton do serviço.
    """
    router = APIRouter()

    def _matrix():
        return (matrix_provider or get_capability_matrix)()

    def _catalog_ids() -> set[str] | None:
        if models_fetcher is None:
            return None
        try:
            return _installed_model_ids(models_fetcher())
        except Exception as exc:  # pragma: no cover — catálogo indisponível
            _log.debug("[capabilities] model catalog unavailable: %s", exc)
            return None

    # ----------------------------------------------------------- models
    @router.get("/api/v1/capabilities/models")
    async def list_capability_models() -> dict[str, Any]:
        matrix = _matrix()
        installed = _catalog_ids()
        models = matrix.annotate_catalog(installed) if installed is not None else [
            matrix.summary_for_model(model_id) for model_id in matrix.model_ids()
        ]
        return {"count": len(models), "models": models}

    # -------------------------------------------------------- runtimes
    @router.get("/api/v1/capabilities/models/{model_id}/runtimes")
    async def list_model_runtimes(model_id: str) -> dict[str, Any]:
        matrix = _matrix()
        entries = matrix.for_model(model_id)
        if not entries:
            raise HTTPException(
                status_code=404, detail=f"Model not in capability matrix: {model_id!r}",
            )
        runtimes: list[dict[str, Any]] = []
        for runtime_value in matrix.runtimes_for(model_id):
            runtime_entries = matrix.for_model_runtime(
                model_id, Runtime(runtime_value),
            )
            runtimes.append({
                "runtime": runtime_value,
                "modes": [e.mode for e in runtime_entries],
                "capabilities": sorted(
                    {c.value for e in runtime_entries for c in e.capabilities}
                ),
            })
        return {"model_id": model_id, "runtimes": runtimes}

    # ------------------------------------------------------------ check
    @router.get("/api/v1/capabilities/check")
    async def check_capability(
        model: str = Query(...),
        runtime: str = Query(...),
        mode: str = Query(...),
        cap: str = Query(...),
    ) -> dict[str, Any]:
        # Capability desconhecida dispara erro (spec §2.1: "capability
        # ausente dispara erro"); runtime/model/mode desconhecidos dão False.
        try:
            capability = Capability(cap)
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail=f"Unknown capability: {cap!r}",
            ) from exc
        try:
            runtime_enum = Runtime(runtime)
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail=f"Unknown runtime: {runtime!r}",
            ) from exc
        available = _matrix().check(model, runtime_enum, mode, capability)
        return {
            "model": model,
            "runtime": runtime,
            "mode": mode,
            "cap": cap,
            "available": available,
        }

    return router


__all__ = ["build_capabilities_router"]
