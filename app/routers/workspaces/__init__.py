"""Workspaces (projects) domain router (A16).

Public factory consumed by ``launch.py``::

    from routers.workspaces import WorkspaceDeps, build_workspaces_router
    api.include_router(build_workspaces_router(deps))
"""
from __future__ import annotations

from fastapi import APIRouter

from .workspaces_service import WorkspaceDeps, register_routes

__all__ = ["WorkspaceDeps", "build_workspaces_router"]


def build_workspaces_router(deps: WorkspaceDeps) -> APIRouter:
    """Return a router with the nine ``/api/v1/workspaces`` endpoints."""
    router = APIRouter()
    register_routes(router, deps)
    return router
