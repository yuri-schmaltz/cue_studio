"""Router de ferramentas de pós-processamento (/api/v1/tools).

Endpoints para:
- Upscaling de vídeo/imagem (/api/v1/tools/upscale)
- Adição de grão de filme (/api/v1/tools/film-grain)
- Nitidez / Sharpening (/api/v1/tools/sharpen)
- Revoice / Dublagem / Troca de voz (/api/v1/tools/revoice)
"""
from __future__ import annotations

import logging
from typing import Any, Callable
from fastapi import APIRouter, Request

_log = logging.getLogger("cue_studio.routers.tools")


def build_tools_router(
    *,
    upscale_fn: Callable[[Request], Any],
    film_grain_fn: Callable[[Request], Any],
    sharpen_fn: Callable[[Request], Any],
    revoice_fn: Callable[[Request], Any],
) -> APIRouter:
    router = APIRouter(tags=["tools"])

    @router.post("/api/v1/tools/upscale")
    async def tools_upscale(request: Request):
        """Upscale a video or image using RealESRGAN."""
        res = upscale_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.post("/api/v1/tools/film-grain")
    async def tools_film_grain(request: Request):
        """Add organic 35mm film grain overlay to a video."""
        res = film_grain_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.post("/api/v1/tools/sharpen")
    async def tools_sharpen(request: Request):
        """Apply unsharp mask sharpening filter to a video."""
        res = sharpen_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.post("/api/v1/tools/revoice")
    async def tools_revoice(request: Request):
        """Revoice a video with translated or replaced TTS speech."""
        res = revoice_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    return router
