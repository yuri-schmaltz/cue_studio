"""Router de processamento e análise de áudio (/api/v1/audio e /api/v1/upload-audio).

Endpoints para:
- Upload de arquivo de áudio ou vídeo para extração (/api/v1/upload-audio)
- Mixagem e alinhamento de áudio (/api/v1/audio/mix)
- Análise de áudio, batidas e vocais (/api/v1/audio/analyze)
- Status do polling de análise (/api/v1/audio/analyze/status)
- Sugestão de cortes de plano por energia (/api/v1/audio/suggest-clips)
- Planejamento de estrutura de planos (/api/v1/audio/plan-structure)
"""
from __future__ import annotations

import logging
from typing import Any, Callable
from fastapi import APIRouter, File, Request, UploadFile

_log = logging.getLogger("cue_studio.routers.audio")


def build_audio_router(
    *,
    upload_audio_fn: Callable[..., Any],
    mix_fn: Callable[[Request], Any],
    analyze_fn: Callable[[Request], Any],
    analyze_status_fn: Callable[[], Any],
    suggest_clips_fn: Callable[[Request], Any],
    plan_structure_fn: Callable[[Request], Any],
) -> APIRouter:
    router = APIRouter(tags=["audio"])

    @router.post("/api/v1/upload-audio")
    async def upload_audio(request: Request, file: UploadFile = File(...)):
        """Upload an audio file OR video file for audio extraction."""
        res = upload_audio_fn(request, file)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.post("/api/v1/audio/mix")
    async def mix_audio(request: Request):
        """Mix audio tracks with volume envelope and alignment."""
        res = mix_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.post("/api/v1/audio/analyze")
    async def analyze_audio(request: Request):
        """Analyze beats, tempo, energy, and lyrics of an audio file."""
        res = analyze_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.get("/api/v1/audio/analyze/status")
    def analyze_audio_status():
        """Get the current progress of audio analysis."""
        return analyze_status_fn()

    @router.post("/api/v1/audio/suggest-clips")
    async def suggest_clips(request: Request):
        """Suggest clip boundaries based on audio analysis beats and energy."""
        res = suggest_clips_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.post("/api/v1/audio/plan-structure")
    async def plan_structure(request: Request):
        """Plan a clip structure matching song sections and pacing."""
        res = plan_structure_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    return router
