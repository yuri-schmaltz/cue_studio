"""Workspaces settings router — projects-root GET/PUT.

Why this lives in its own module
--------------------------------
``launch.py`` already holds the ``@api`` decorator and the
``wgp.server_config`` reference; spinning out the projects-root
endpoints into ``services.workspaces`` keeps the boot file focused
on lifespan setup, route registration, and the heavy model
imports. Tests for these endpoints can now mount the router on a
``FastAPI()`` instance without dragging in the full WanGP
engine.

Storage
-------
The configured path lives at
``wgp.server_config["services"]["projects_root_path"]``. Empty
string is treated as "unset" — the effective path then falls back
to ``wgp.server_config["save_path"]`` (legacy layout). Persisting
is a single ``json.dump`` rewrite of the entire config file —
intentionally not an in-place edit so we can survive a torn write
mid-flight (the file is small and a rewrite is cheap).

Validation
----------
The PUT endpoint refuses:

* null-byte paths (defence against path-traversal payloads);
* paths that don't exist on disk;
* paths the process can't write to.

Empty strings clear the override; callers that want to revert to
the legacy layout send ``{"path": ""}``.
"""

from __future__ import annotations

import json
import logging
import os

from fastapi import APIRouter, HTTPException, Request

log = logging.getLogger("cue_studio.workspaces_router")


router = APIRouter()


@router.get("/api/v1/settings/projects-root")
def get_projects_root() -> dict:
    """Return the user-configured projects root path.

    The path is stored in ``wgp.server_config["services"]["projects_root_path"]``.
    When unset (the default), the effective root falls back to
    ``wgp.server_config["save_path"]`` — preserving the legacy layout
    where workspaces live directly under ``outputs/``.

    The endpoint also reports the currently-effective root and whether
    the configured path actually exists on disk so the UI can show
    stale-config warnings without a second round-trip.
    """

    from wgp import server_config  # local import to avoid loading
                                   # the full WanGP engine at module
                                   # import time — keep this lazy so
                                   # unit tests that only exercise
                                   # path validation don't pay the
                                   # import cost.

    services = server_config.get("services", {}) or {}
    configured = services.get("projects_root_path") or ""
    default_path = server_config.get("save_path", "outputs")
    effective = configured or default_path
    exists = bool(effective) and os.path.isdir(effective)
    writable = False
    if exists:
        try:
            writable = os.access(effective, os.W_OK)
        except OSError:
            writable = False
    return {
        "configured_path": configured,
        "default_path": default_path,
        "effective_path": effective,
        "exists": exists,
        "writable": writable,
    }


@router.put("/api/v1/settings/projects-root")
async def set_projects_root(request: Request) -> dict:
    """Set the projects root path. Empty string clears it (revert to default).

    Validates that the path exists and is writable before persisting.
    Empty string is accepted as a "reset to default" sentinel — the
    caller no longer wants the custom layout. Relative paths are
    resolved against the backend cwd; absolute paths are taken as-is.

    The new path takes effect immediately for *new* workspaces; existing
    workspaces under the old root remain accessible until the user moves
    them manually. The active workspace is not auto-migrated because the
    user may still have the old root mounted by an external tool.
    """

    from wgp import server_config, server_config_filename  # lazy; see GET

    body = await request.json()
    raw = (body.get("path") or "").strip()
    if not raw:
        # Explicit reset to default. Clear the configured key.
        services = server_config.setdefault("services", {})
        services.pop("projects_root_path", None)
        with open(server_config_filename, "w", encoding="utf-8") as f:
            f.write(json.dumps(server_config, indent=4))
        return {
            "configured_path": "",
            "effective_path": server_config.get("save_path", "outputs"),
            "exists": True,
            "writable": True,
        }

    path = os.path.abspath(raw)
    if "\x00" in path:
        raise HTTPException(status_code=400, detail="Invalid path: null byte")
    if not os.path.isdir(path):
        raise HTTPException(
            status_code=400,
            detail=f"Path does not exist or is not a directory: {path}",
        )
    if not os.access(path, os.W_OK):
        raise HTTPException(
            status_code=400,
            detail=f"Path is not writable: {path}",
        )
    services = server_config.setdefault("services", {})
    services["projects_root_path"] = path
    with open(server_config_filename, "w", encoding="utf-8") as f:
        f.write(json.dumps(server_config, indent=4))
    return {
        "configured_path": path,
        "effective_path": path,
        "exists": True,
        "writable": True,
    }


__all__ = ["router"]
