"""HTTP router for the Video Editor (Phase D-min of HocusPocus migration).

Endpoints expose CRUD on projects, clip operations, and export. The router
is intentionally thin: validation lives in :mod:`app.services.video_editor`.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field


log = logging.getLogger("cue_studio.routers.video_editor")


class ProjectIn(BaseModel):
    title: str = "Untitled"


class ClipIn(BaseModel):
    media_path: str
    start: float = 0.0
    end: float | None = None
    label: str | None = None
    audio_gain: float = 1.0


class TrimIn(BaseModel):
    start: float
    end: float


class SplitIn(BaseModel):
    at_seconds: float = Field(..., gt=0)


class ReorderIn(BaseModel):
    order: list[str]


class ExportIn(BaseModel):
    output_path: str | None = None


def build_video_editor_router(get_editor):
    """Build the FastAPI router. ``get_editor`` is a zero-arg callable that
    returns the singleton :class:`VideoEditor` (so launch.py can wire the
    live instance while tests can inject a temp-dir editor).
    """

    router = APIRouter(prefix="/api/v1/editor", tags=["video-editor"])

    def _ed():
        ed = get_editor()
        if ed is None:
            raise HTTPException(status_code=503, detail="editor not initialized")
        return ed

    # -------------------------------------------------------------- projects

    @router.get("/projects")
    def list_projects(limit: int = 50) -> dict[str, Any]:
        try:
            editor = _ed()
            return {"projects": editor.list_projects(limit=limit)}
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - safety
            log.exception("list_projects failed")
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/projects", status_code=201)
    def create_project(payload: ProjectIn = Body(...)) -> dict[str, Any]:
        return _ed().create_project(title=payload.title)

    @router.get("/projects/{project_id}")
    def get_project(project_id: str) -> dict[str, Any]:
        project = _ed().get_project(project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="project not found")
        return project

    @router.delete("/projects/{project_id}", status_code=204)
    def delete_project(project_id: str) -> None:
        ok = _ed().delete_project(project_id)
        if not ok:
            raise HTTPException(status_code=404, detail="project not found")

    # ---------------------------------------------------------------- clips

    @router.post("/projects/{project_id}/clips", status_code=201)
    def add_clip(project_id: str, payload: ClipIn = Body(...)) -> dict[str, Any]:
        from app.services.video_editor import EditorError
        try:
            return _ed().add_clip(project_id, payload.model_dump())
        except EditorError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @router.delete("/projects/{project_id}/clips/{clip_id}", status_code=200)
    def remove_clip(project_id: str, clip_id: str) -> dict[str, Any]:
        from app.services.video_editor import EditorError
        try:
            return _ed().remove_clip(project_id, clip_id)
        except EditorError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @router.post("/projects/{project_id}/clips/reorder")
    def reorder_clips(project_id: str, payload: ReorderIn = Body(...)) -> dict[str, Any]:
        from app.services.video_editor import EditorError
        try:
            return _ed().reorder_clips(project_id, payload.order)
        except EditorError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @router.post("/projects/{project_id}/clips/{clip_id}/trim")
    def trim_clip(project_id: str, clip_id: str, payload: TrimIn = Body(...)) -> dict[str, Any]:
        from app.services.video_editor import EditorError
        try:
            return _ed().trim_clip(
                project_id, clip_id, start=payload.start, end=payload.end,
            )
        except EditorError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @router.post("/projects/{project_id}/clips/{clip_id}/split")
    def split_clip(project_id: str, clip_id: str, payload: SplitIn = Body(...)) -> dict[str, Any]:
        from app.services.video_editor import EditorError
        try:
            return _ed().split_clip(project_id, clip_id, at_seconds=payload.at_seconds)
        except EditorError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    # --------------------------------------------------------------- export

    @router.post("/projects/{project_id}/export")
    def export_project(
        project_id: str,
        payload: ExportIn | None = Body(default=None),
    ) -> dict[str, Any]:
        from app.services.video_editor import EditorError
        output_path = payload.output_path if payload else None
        try:
            return _ed().export(project_id, output_path=output_path)
        except EditorError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    return router
