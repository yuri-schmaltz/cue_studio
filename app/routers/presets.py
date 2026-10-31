"""Router de Generation Presets (/api/v1/presets).

Gerenciamento de presets de geração (salvar, listar, excluir).
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

_log = logging.getLogger("cue_studio.routers.presets")


def build_presets_router(
    presets_file: str,
    *,
    load_presets: Callable[[], list[dict]] | None = None,
    save_presets: Callable[[list[dict]], None] | None = None,
) -> APIRouter:
    router = APIRouter(tags=["presets"])

    def _default_load() -> list[dict]:
        if os.path.isfile(presets_file):
            try:
                with open(presets_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def _default_save(presets: list[dict]):
        with open(presets_file, "w", encoding="utf-8") as f:
            json.dump(presets, f, indent=2)

    _load = load_presets or _default_load
    _save = save_presets or _default_save

    @router.get("/api/v1/presets")
    def list_presets():
        """List all saved generation presets."""
        return {"presets": _load()}

    @router.post("/api/v1/presets")
    async def create_preset(request: Request):
        """Save a new generation preset."""
        body = await request.json()
        name = body.get("name", "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")

        preset = {
            "id": uuid.uuid4().hex[:8],
            "name": name,
            "mode": body.get("mode", "video"),
            "model_type": body.get("model_type", ""),
            "prompt": body.get("prompt", ""),
            "activated_loras": body.get("activated_loras", []),
            "loras_multipliers": body.get("loras_multipliers", ""),
            "lora_weights": body.get("lora_weights", {}),
            "params": body.get("params", {}),
            "created_at": time.time(),
        }

        presets = _load()
        presets.append(preset)
        _save(presets)
        return preset

    @router.delete("/api/v1/presets/{preset_id}")
    def delete_preset(preset_id: str):
        """Delete a preset by ID."""
        presets = _load()
        new_presets = [p for p in presets if p.get("id") != preset_id]
        if len(new_presets) == len(presets):
            raise HTTPException(status_code=404, detail="Preset not found")
        _save(new_presets)
        return {"deleted": preset_id}

    return router

