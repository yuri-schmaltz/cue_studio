"""Scaffold do router Projects (A16).

Use como ponto de partida ao extrair rotas de /api/projects do launch.py.
Não importa nada de app/; este arquivo é autocontido.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))

from typing import Optional  # noqa: E402

from fastapi import APIRouter, Depends, HTTPException, Query  # noqa: E402

from api_errors import ApiError, ErrorCode  # noqa: E402
from projects import (  # noqa: E402
    Project,
    ProjectCreate,
    ProjectListResponse,
    ProjectSummary,
)


class ProjectsServiceProto:
    """Stub. Substituir pela implementação real em produção."""

    def list(self, type_filter: Optional[str], page: int) -> ProjectListResponse:
        return ProjectListResponse(items=[], page=page, total=0)

    def create(self, payload: ProjectCreate) -> Project:
        return Project(
            id="demo",
            name=payload.name,
            type=payload.type,
            updated_at=__import__("datetime").datetime.now(),
            preset_id=payload.preset_id,
        )

    def get(self, project_id: str) -> Optional[Project]:
        return None

    def delete(self, project_id: str) -> bool:
        return True

    def update_briefing(self, project_id: str, payload) -> Optional[Project]:
        return None


_service: ProjectsServiceProto = ProjectsServiceProto()


def get_projects_service() -> ProjectsServiceProto:
    return _service


def build_projects_router() -> APIRouter:
    r = APIRouter(prefix="/api/projects", tags=["projects"])

    @r.get("", response_model=ProjectListResponse)
    def list_projects(
        type: Optional[str] = Query(default=None),
        page: int = Query(default=1, ge=1),
    ) -> ProjectListResponse:
        return _service.list(type, page)

    @r.post("", response_model=Project, status_code=201)
    def create_project(payload: ProjectCreate) -> Project:
        return _service.create(payload)

    @r.get("/{project_id}", response_model=Project)
    def get_project(project_id: str) -> Project:
        p = _service.get(project_id)
        if p is None:
            raise ApiError(ErrorCode.PROJECT_NOT_FOUND, "Projeto não encontrado", status=404)
        return p

    @r.delete("/{project_id}", status_code=204)
    def delete_project(project_id: str) -> None:
        if not _service.delete(project_id):
            raise ApiError(ErrorCode.PROJECT_NOT_FOUND, "Projeto não encontrado", status=404)

    return r


# Smoke test local (não roda import em main.ts; em produção, importar em launch.py)
if __name__ == "__main__":
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api_errors import install_api_error_handler

    app = FastAPI()
    install_api_error_handler(app)
    app.include_router(build_projects_router())
    c = TestClient(app)

    r = c.get("/api/projects")
    assert r.status_code == 200, r.text

    r = c.post("/api/projects", json={"name": "MV", "type": "music-video"})
    assert r.status_code == 201, r.text

    r = c.get("/api/projects/inexistente")
    assert r.status_code == 404, r.text
    body = r.json()
    assert body["code"] == "project.not_found", body
    assert "operationId" in body, body

    print("OK scaffold/router_projects.py")