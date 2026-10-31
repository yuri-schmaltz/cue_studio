"""Editor document and media HTTP API, independent of the generation runtime."""
from __future__ import annotations

import asyncio
from typing import Callable
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from services.editor_projects import (
    EditorProjectError, build_editor_media_preview, create_editor_project,
    delete_editor_project, editor_export_capabilities, inspect_editor_assets,
    list_editor_projects, load_editor_project, probe_media, resolve_editor_asset,
    resolve_editor_media_cache_file, save_editor_project,
)


def build_editor_projects_router(
    *, save_root: Callable[[], str], uploads_root: Callable[[], str],
    active_workspace: Callable[[], str],
) -> APIRouter:
    router = APIRouter(tags=["editor"])

    @router.get("/api/v1/editor/projects")
    def editor_projects_list(workspace: str = ""):
        workspace = workspace or active_workspace()
        try:
            return {
                "projects": list_editor_projects(
                    save_root(),
                    workspace,
                ),
            }
        except EditorProjectError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


    @router.post("/api/v1/editor/projects")
    async def editor_project_create(request: Request):
        body = await request.json()
        workspace = body.get("workspace") or active_workspace()
        try:
            project = body.get("project")
            if not isinstance(project, dict):
                canvas = body.get("canvas") if isinstance(body.get("canvas"), dict) else {}
                project = create_editor_project(
                    name=body.get("name") or "Untitled project",
                    workspace=workspace,
                    width=int(canvas.get("width") or 1920),
                    height=int(canvas.get("height") or 1080),
                    fps=float(canvas.get("fps") or 30),
                )
            return save_editor_project(save_root(), workspace, project)
        except (EditorProjectError, TypeError, ValueError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


    @router.get("/api/v1/editor/projects/{project_id}")
    def editor_project_get(project_id: str, workspace: str = ""):
        workspace = workspace or active_workspace()
        try:
            return load_editor_project(save_root(), workspace, project_id)
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail="Editor project not found") from error
        except EditorProjectError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


    @router.put("/api/v1/editor/projects/{project_id}")
    async def editor_project_update(project_id: str, request: Request):
        body = await request.json()
        workspace = body.get("workspace") or active_workspace()
        project = body.get("project") if isinstance(body.get("project"), dict) else body
        project = dict(project)
        project["id"] = project_id
        try:
            return save_editor_project(save_root(), workspace, project)
        except EditorProjectError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


    @router.delete("/api/v1/editor/projects/{project_id}")
    def editor_project_delete(project_id: str, workspace: str = ""):
        workspace = workspace or active_workspace()
        try:
            deleted = delete_editor_project(save_root(), workspace, project_id)
        except EditorProjectError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not deleted:
            raise HTTPException(status_code=404, detail="Editor project not found")
        return {"deleted": project_id}


    @router.post("/api/v1/editor/media/probe")
    async def editor_media_probe(request: Request):
        body = await request.json()
        workspace = body.get("workspace") or active_workspace()
        asset = body.get("asset") if isinstance(body.get("asset"), dict) else body
        try:
            filepath = resolve_editor_asset(
                asset,
                save_root=save_root(),
                workspace=workspace,
                uploads_root=uploads_root(),
            )
            return {
                **probe_media(filepath),
                "path": filepath,
            }
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail="Editor media not found") from error
        except EditorProjectError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


    @router.post("/api/v1/editor/media/status")
    async def editor_media_status(request: Request):
        body = await request.json()
        workspace = body.get("workspace") or active_workspace()
        project = body.get("project") if isinstance(body.get("project"), dict) else body
        try:
            return {
                "assets": inspect_editor_assets(
                    project,
                    save_root=save_root(),
                    workspace=workspace,
                    uploads_root=uploads_root(),
                ),
            }
        except EditorProjectError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


    @router.post("/api/v1/editor/media/preview")
    async def editor_media_preview(request: Request):
        body = await request.json()
        workspace = body.get("workspace") or active_workspace()
        asset = body.get("asset") if isinstance(body.get("asset"), dict) else body
        proxy_profile = (
            "mobile"
            if str(body.get("proxy_profile") or "auto").strip().lower() == "mobile"
            else "auto"
        )
        try:
            preview = await asyncio.to_thread(
                build_editor_media_preview,
                asset,
                save_root=save_root(),
                workspace=workspace,
                uploads_root=uploads_root(),
                include_proxy=bool(body.get("include_proxy", False)),
                proxy_profile=proxy_profile,
            )
            preview_id = preview["preview_id"]
            workspace_query = f"?workspace={quote(str(workspace), safe='')}"
            proxy_field = "proxy_mobile" if proxy_profile == "mobile" else "proxy"
            proxy_kind = "proxy-mobile" if proxy_profile == "mobile" else "proxy"
            return {
                "preview_id": preview_id,
                "thumbnail_url": (
                    f"/api/v1/editor/media/cache/{preview_id}/thumbnail{workspace_query}"
                    if preview.get("thumbnail") else None
                ),
                "proxy_url": (
                    f"/api/v1/editor/media/cache/{preview_id}/{proxy_kind}{workspace_query}"
                    if preview.get(proxy_field) else None
                ),
                "waveform": preview.get("waveform") or [],
            }
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail="Editor media not found") from error
        except EditorProjectError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


    @router.get("/api/v1/editor/media/cache/{preview_id}/{kind}")
    def editor_media_cache(preview_id: str, kind: str, workspace: str = ""):
        workspace = workspace or active_workspace()
        try:
            path = resolve_editor_media_cache_file(
                save_root(), workspace, preview_id, kind
            )
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail="Editor preview not found") from error
        except EditorProjectError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        media_type = "video/mp4" if kind in {"proxy", "proxy-mobile"} else "image/jpeg"
        # Preview IDs include the source path, size, and mtime, so these artifacts
        # are immutable. Explicit caching lets iOS reuse the standby deck's range
        # data when the persistent playback deck reaches the edit instead of
        # requesting the same proxy data twice over the network.
        return FileResponse(
            path,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=86400, immutable"},
        )


    @router.get("/api/v1/editor/export/capabilities")
    def editor_export_capability_list():
        return editor_export_capabilities()

    return router
