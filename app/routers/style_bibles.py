"""Router de Style Bibles (/api/v1/style-bibles).

Gerenciamento e persistência de bíblias de estilo, personagens, ambientes e
composição de prompts parametrizados.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

_log = logging.getLogger("cue_studio.routers.style_bibles")


def build_style_bibles_router() -> APIRouter:
    router = APIRouter(tags=["style-bibles"])

    @router.get("/api/v1/style-bibles")
    def list_style_bibles():
        """List all saved Style Bibles."""
        from services.style_bible import list_bibles

        out = []
        for bible in list_bibles():
            out.append({
                "id": bible.metadata.id,
                "title": bible.metadata.title,
                "description": bible.metadata.description,
                "author": bible.metadata.author,
                "tags": list(bible.metadata.tags),
                "characters_count": len(bible.characters),
                "environments_count": len(bible.environments),
                "loras_count": len(bible.loras),
                "global_style": bible.global_style,
                "global_negative": bible.global_negative,
            })
        return {"bibles": out}

    @router.get("/api/v1/style-bibles/{bible_id}")
    def get_style_bible(bible_id: str):
        """Return the full contents of a Style Bible."""
        from services.style_bible import load_bible

        try:
            bible = load_bible(bible_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return bible.to_dict()

    @router.put("/api/v1/style-bibles/{bible_id}")
    async def put_style_bible(bible_id: str, request: Request):
        """Persist a Style Bible."""
        from services.style_bible import StyleBible, save_bible

        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="JSON object required")
        if "metadata" not in body or not isinstance(body["metadata"], dict):
            raise HTTPException(status_code=400, detail="metadata key is required")
        if body["metadata"].get("id") != bible_id:
            raise HTTPException(
                status_code=400,
                detail=f"body metadata.id ({body['metadata'].get('id')!r}) "
                f"does not match path bible_id ({bible_id!r})",
            )
        try:
            bible = StyleBible.from_dict(body)
        except (ValueError, KeyError) as exc:
            raise HTTPException(status_code=400, detail=f"invalid bible: {exc}") from exc
        try:
            path = save_bible(bible)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"id": bible.metadata.id, "path": str(path)}

    @router.post("/api/v1/style-bibles")
    async def create_style_bible(request: Request):
        """Create a new Style Bible."""
        from services.style_bible import StyleBible, save_bible
        from services.style_bible.registry import BIBLE_DEFAULT_DIR

        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="JSON object required")
        try:
            bible = StyleBible.from_dict(body)
        except (ValueError, KeyError) as exc:
            raise HTTPException(status_code=400, detail=f"invalid bible: {exc}") from exc
        target = BIBLE_DEFAULT_DIR / f"{bible.metadata.id}.json"
        yaml_target = BIBLE_DEFAULT_DIR / f"{bible.metadata.id}.yaml"
        yml_target = BIBLE_DEFAULT_DIR / f"{bible.metadata.id}.yml"
        if target.exists() or yaml_target.exists() or yml_target.exists():
            raise HTTPException(
                status_code=409,
                detail=f"Style Bible already exists: {bible.metadata.id} "
                f"(use PUT /api/v1/style-bibles/{bible.metadata.id} to update)",
            )
        try:
            path = save_bible(bible, overwrite=False)
        except FileExistsError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"id": bible.metadata.id, "path": str(path)}

    @router.delete("/api/v1/style-bibles/{bible_id}")
    def delete_style_bible(bible_id: str):
        """Delete a Style Bible by id."""
        from services.style_bible import delete_bible

        try:
            removed = delete_bible(bible_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not removed:
            raise HTTPException(
                status_code=404,
                detail=f"Style Bible not found: {bible_id}",
            )
        return {"deleted": bible_id}

    @router.post("/api/v1/style-bibles/{bible_id}/build")
    async def build_style_bible_prompt(bible_id: str, request: Request):
        """Compose a prompt from a Style Bible + base prompt + character / environment ids."""
        from services.style_bible import PromptBuilder, load_bible

        try:
            bible = load_bible(bible_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        body = (
            await request.json()
            if request.headers.get("content-type", "").startswith("application/json")
            else {}
        )
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="JSON object required")
        result = PromptBuilder().build(
            bible,
            base_prompt=str(body.get("base_prompt", "") or ""),
            character_ids=tuple(body.get("character_ids", []) or []),
            environment_id=body.get("environment_id"),
            negative_prompt=str(body.get("negative_prompt", "") or ""),
        )
        return {
            "prompt": result.prompt,
            "negative_prompt": result.negative_prompt,
            "active_loras": [
                {"name": l.name, "weight": l.weight, "file_path": l.file_path}
                for l in result.active_loras
            ],
            "character_anchors": [
                {"id": c.id, "name": c.name} for c in result.character_anchors
            ],
            "environment_anchor": (
                {"id": result.environment_anchor.id, "name": result.environment_anchor.name}
                if result.environment_anchor is not None
                else None
            ),
        }

    return router

