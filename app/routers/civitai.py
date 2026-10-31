"""Router de integração com CivitAI (/api/v1/civitai).

Fornece endpoints para:
- Listar filtros de modelos base (/api/v1/civitai/base-models)
- Listar arquiteturas de checkpoint (/api/v1/civitai/checkpoint-architectures)
- Busca no catálogo CivitAI com cache (/api/v1/civitai/search)
- Detalhes de modelo e versões (/api/v1/civitai/model/{model_id})
- Download em background com validação (/api/v1/civitai/download)
- Status de downloads em andamento (/api/v1/civitai/downloads)
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List
from fastapi import APIRouter, HTTPException, Request

_log = logging.getLogger("cue_studio.routers.civitai")


def build_civitai_router(
    *,
    model_filters: List[Dict[str, Any]],
    list_checkpoint_architectures_fn: Callable[[str], List[Dict[str, Any]]],
    suggested_checkpoint_architecture_fn: Callable[[str], str | None],
    checkpoint_targets_for_base_fn: Callable[[str], List[str]],
    unsupported_checkpoint_reason_fn: Callable[[str], str | None],
    search_fn: Callable[..., Any],
    model_detail_fn: Callable[[int], Any],
    download_fn: Callable[[Request], Any],
    downloads_status_fn: Callable[[], Any],
) -> APIRouter:
    router = APIRouter(tags=["civitai"])

    @router.get("/api/v1/civitai/base-models")
    def civitai_base_models():
        """Return supported model filters for the browser."""
        return {"filters": model_filters}

    @router.get("/api/v1/civitai/checkpoint-architectures")
    def civitai_checkpoint_architectures(base_model: str = ""):
        """List only checkpoint pipelines verified for this CivitAI base label."""
        architectures = list_checkpoint_architectures_fn(base_model)
        guess = suggested_checkpoint_architecture_fn(base_model)
        available = {entry["architecture"] for entry in architectures}
        if guess not in available:
            guess = None
        supported = bool(architectures)
        if supported:
            reason = None
        elif checkpoint_targets_for_base_fn(base_model):
            reason = (
                "Cue Studio recognizes this checkpoint family, but its required "
                "pipeline definition is unavailable in this installation. Update "
                "Cue Studio and try again."
            )
        else:
            reason = unsupported_checkpoint_reason_fn(base_model)
        return {
            "architectures": architectures,
            "suggested_architecture": guess,
            "supported": supported,
            "unsupported_reason": reason,
        }

    @router.get("/api/v1/civitai/search")
    def civitai_search(
        query: str = "", sort: str = "Highest Rated", period: str = "AllTime",
        nsfw: bool = False, types: str = "LORA", baseModels: str = "",
        limit: int = 20, cursor: str = "",
    ):
        """Proxy CivitAI model search (TTL-cached)."""
        return search_fn(
            query=query, sort=sort, period=period, nsfw=nsfw,
            types=types, baseModels=baseModels, limit=limit, cursor=cursor,
        )

    @router.get("/api/v1/civitai/model/{model_id}")
    def civitai_model_detail(model_id: int):
        """Fetch CivitAI model details with local architecture mapping (TTL-cached)."""
        return model_detail_fn(model_id)

    @router.post("/api/v1/civitai/download")
    async def civitai_download(request: Request):
        """Start downloading a file from CivitAI."""
        res = download_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.get("/api/v1/civitai/downloads")
    def civitai_downloads_status():
        """List active and recent downloads."""
        return downloads_status_fn()

    return router
