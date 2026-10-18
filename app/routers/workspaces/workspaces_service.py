"""Workspaces (projects) domain handlers (A16 — routers by domain).

These nine endpoints were extracted verbatim from ``app/launch.py`` so
the launch module only *composes* routers. Every launch-internal helper
is injected through :class:`WorkspaceDeps`, which keeps this package free
of any ``launch`` import (see the A16 acceptance check: no router module
imports the launch package) and lets tests build the router with fakes.

URLs and behaviour are unchanged — the parsing, status codes, and error
messages are the same ones the inline handlers used.
"""
from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from .schemas import (
    INVALID_NAME_MESSAGE,
    is_valid_workspace_name,
)


@dataclass
class WorkspaceDeps:
    """Injected launch.py internals (A16 DI seam).

    Callables keep the *live* wiring: ``jobs`` / ``active_gen_states``
    are providers so the handlers always see the current process state.
    """

    list_workspaces: Callable[[], list[dict]]
    get_active_workspace: Callable[[], str]
    persist_active_workspace: Callable[..., str]
    active_gen_states: Callable[[], Mapping]
    jobs: Callable[[], Mapping]
    projects_root: Callable[[], str]
    workspace_dir: Callable[[str], str]
    load_workspace_setup: Callable[[str], dict]
    persist_workspace_setup: Callable[[str, dict], dict]
    save_cover_image: Callable[..., str]
    delete_cover_image: Callable[..., None]
    cover_image_path: Callable[..., str | None]
    safe_join: Callable[..., str | None]
    workspace_setup_error: type[Exception]


def register_routes(router: APIRouter, deps: WorkspaceDeps) -> APIRouter:
    """Register the nine workspace endpoints on ``router`` (pre-A16 order)."""

    # ---------------------------------------------------------------- list
    @router.get("/api/v1/workspaces")
    def list_workspaces_endpoint():
        """List all workspaces and the active one."""
        return {
            "workspaces": deps.list_workspaces(),
            "active": deps.get_active_workspace(),
        }

    # -------------------------------------------------------------- active
    @router.put("/api/v1/workspaces/active")
    async def set_active_workspace(request: Request):
        """Switch to a different workspace."""
        body = await request.json()
        name = body.get("name", "default")

        # Validate name (alphanumeric, hyphens, underscores)
        if name != "default" and not is_valid_workspace_name(name):
            raise HTTPException(status_code=400, detail=INVALID_NAME_MESSAGE)

        # Persist the switch; only touch wgp.save_path when idle. If a job is
        # in progress it has locked wgp.save_path to its target workspace —
        # overwriting mid-generation scatters clips across workspaces. The
        # config is saved either way, so the next job or restart picks it up.
        idle = not deps.active_gen_states()
        ws_dir = deps.persist_active_workspace(name, apply_save_paths=idle)
        if idle:
            print(f"[Workspace] Switched to: {name} ({ws_dir})")
        else:
            print(f"[Workspace] Config switched to: {name} (save_path deferred — generation in progress)")
        return {"status": "ok", "active": name, "path": ws_dir}

    # -------------------------------------------------------------- create
    @router.post("/api/v1/workspaces")
    async def create_workspace(request: Request):
        """Create a new workspace."""
        body = await request.json()
        name = body.get("name", "").strip()

        if not name:
            raise HTTPException(status_code=400, detail="Workspace name is required")

        if not is_valid_workspace_name(name):
            raise HTTPException(status_code=400, detail=INVALID_NAME_MESSAGE)

        ws_dir = deps.workspace_dir(name)
        os.makedirs(ws_dir, exist_ok=True)

        return {"status": "ok", "name": name, "path": ws_dir}

    # --------------------------------------------------------------- setup
    @router.get("/api/v1/workspaces/{name}/setup")
    def get_workspace_setup(name: str):
        """Return the ProjectSetup JSON for a workspace.

        Missing file → defaults. Default workspace → defaults. Used by the
        UI to hydrate the Director selection on `switchWorkspace` so the
        user starts a session with the same aspect ratio / resolution /
        models they used last time in this project. Idempotent.
        """
        return {"name": name, "setup": deps.load_workspace_setup(name)}

    @router.put("/api/v1/workspaces/{name}/setup")
    async def put_workspace_setup(name: str, request: Request):
        """Update the ProjectSetup for a workspace. Atomic write.

        Shared between the New project dialog (POST then PUT to fill the
        just-created folder) and the Edit setup affordance on the project
        card (re-PUT to overwrite). Validation lives in
        `_persist_workspace_setup` so direct callers (e.g. tests) hit the
        same error mapping as the HTTP surface.
        """
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Request body must be a JSON object.")
        raw_setup = body.get("setup", body)
        persisted = deps.persist_workspace_setup(name, raw_setup)
        return {"status": "ok", "name": name, "setup": persisted}

    # --------------------------------------------------------------- cover
    @router.post("/api/v1/workspaces/{name}/cover")
    async def upload_workspace_cover(name: str, file: UploadFile = File(...)):
        """Upload the project card cover image.

        Stores the file next to setup.json under a unique cover_<id>.<ext>
        name and points setup.json at it. The previous cover file is only
        removed after the new setup.json persists, so a failed persist
        never destroys the previous cover.
        """
        base = os.path.abspath(deps.projects_root())
        content = await file.read()
        try:
            stored = deps.save_cover_image(base, name, content, file.filename or "cover.png")
        except deps.workspace_setup_error as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        previous = (deps.load_workspace_setup(name).get("cover_image") or "")
        try:
            current = deps.load_workspace_setup(name)
            current["cover_image"] = stored
            persisted = deps.persist_workspace_setup(name, current)
        except HTTPException:
            deps.delete_cover_image(base, name, stored)
            raise
        if previous and previous != stored:
            deps.delete_cover_image(base, name, previous)
        return {"status": "ok", "name": name, "cover_image": stored, "setup": persisted}

    @router.get("/api/v1/workspaces/{name}/cover")
    def serve_workspace_cover(name: str):
        """Serve the project card cover image referenced by setup.json."""
        from fastapi.responses import FileResponse

        base = os.path.abspath(deps.projects_root())
        filename = (deps.load_workspace_setup(name).get("cover_image") or "")
        path = deps.cover_image_path(base, name, filename) if filename else None
        if path is None:
            raise HTTPException(status_code=404, detail="No cover image for this project.")
        media_type = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".bmp": "image/bmp",
        }.get(os.path.splitext(filename)[1].lower(), "application/octet-stream")
        return FileResponse(path, media_type=media_type)

    @router.delete("/api/v1/workspaces/{name}/cover")
    def delete_workspace_cover(name: str):
        """Remove the project card cover image and clear the setup reference."""
        base = os.path.abspath(deps.projects_root())
        current = deps.load_workspace_setup(name)
        current["cover_image"] = ""
        persisted = deps.persist_workspace_setup(name, current)
        deps.delete_cover_image(base, name)
        return {"status": "ok", "name": name, "setup": persisted}

    # -------------------------------------------------------------- delete
    @router.delete("/api/v1/workspaces/{name}")
    def delete_workspace(name: str):
        """Delete a workspace folder and every asset inside it.

        Refused while anything is queued or generating: jobs capture their
        workspace at submit time and _workspace_dir() recreates folders on
        demand, so a mid-generation delete would silently resurrect the
        workspace and scatter files into it.
        """
        if name == "default":
            raise HTTPException(status_code=400, detail="The default workspace is the outputs folder itself and cannot be deleted.")
        if not is_valid_workspace_name(name):
            raise HTTPException(status_code=400, detail="Invalid workspace name.")
        base = os.path.abspath(deps.projects_root())
        # _safe_join resolves symlinks/junctions before the containment check —
        # the regex blocks traversal but not a junction inside outputs/.
        ws_dir = deps.safe_join(base, name)
        if ws_dir is None:
            raise HTTPException(status_code=400, detail="Invalid workspace path.")
        if not os.path.isdir(ws_dir):
            raise HTTPException(status_code=404, detail=f"Workspace not found: {name}")

        busy = any(
            j.get("status") in ("held", "queued", "running")
            for j in deps.jobs().values()
        )
        if busy or deps.active_gen_states():
            raise HTTPException(status_code=409, detail="A generation is held, queued, or running. Remove it or wait for it to finish before deleting a workspace.")
        # Director pipelines are alive between their generation jobs (LLM
        # planning, review pauses) with no _jobs entry — but their next step
        # would resurrect the folder via _workspace_dir().
        try:
            from services.director_pipeline import any_pipeline_active
            if any_pipeline_active():
                raise HTTPException(status_code=409, detail="A Director pipeline is running or paused. Stop it before deleting a workspace.")
        except ImportError:
            pass

        # Deleting the active workspace switches to default first. Safe to write
        # wgp.save_path directly here: nothing is generating (guards above).
        switched = False
        if deps.get_active_workspace() == name:
            deps.persist_active_workspace("default")
            switched = True
            print(f"[Workspace] Active workspace deleted — switched to default")

        from services.win_safe_files import safe_delete_dir
        result = safe_delete_dir(ws_dir)
        print(f"[Workspace] Deleted '{name}': {result['files_deleted']} files removed, "
              f"{result['files_deferred']} deferred, dir_removed={result['removed']}")
        return {
            "status": "ok", "name": name,
            "files_deleted": result["files_deleted"], "files_deferred": result["files_deferred"],
            "dir_removed": result["removed"], "switched_to_default": switched, "errors": result["errors"],
        }

    return router


__all__ = ["WorkspaceDeps", "register_routes"]
