"""Router de dependências explícitas (A26).

Expõe:
  POST /api/v1/projects/{project_id}/dependencies/graph  — constrói o grafo a partir de shots
  GET  /api/v1/projects/{project_id}/dependencies/impact — impact_of para um recurso alterado
  POST /api/v1/projects/{project_id}/dependencies/regenerate — regenera afetados
  POST /api/v1/projects/{project_id}/dependencies/undo — desfaz última alteração
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.dependency_graph import (
    ResourceKind,
    ResourceRef,
    build_graph_from_shots,
    get_graph,
    impact_of,
    regenerate_affected,
    save_graph,
    undo_impact,
)

router = APIRouter(prefix="/api/v1/projects", tags=["dependencies"])


class BuildGraphRequest(BaseModel):
    shots: list[dict[str, Any]]


class ImpactRequest(BaseModel):
    resource_id: str
    kind: str
    version: int = 1
    source: str = ""


@router.post("/{project_id}/dependencies/graph")
def build_graph(project_id: str, body: BuildGraphRequest) -> dict[str, Any]:
    graph = build_graph_from_shots(project_id, body.shots)
    path = save_graph(graph)
    return {
        "project_id": project_id,
        "edges_count": len(graph.edges),
        "approved_count": len(graph.approved),
        "path": str(path),
    }


@router.get("/{project_id}/dependencies/impact")
def get_impact(
    project_id: str,
    resource_id: str = Query(...),
    kind: str = Query(...),
    version: int = Query(default=1),
    source: str = Query(default=""),
) -> dict[str, Any]:
    graph = get_graph(project_id)
    try:
        ref = ResourceRef(resource_id=resource_id, kind=ResourceKind(kind), version=version, source=source)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    report = impact_of(graph, ref)
    save_graph(graph)
    return {
        "changed": {"resource_id": report.changed.resource_id, "kind": report.changed.kind.value},
        "affected": [{"id": a.id, "kind": a.kind, "staleness": a.staleness} for a in report.affected],
        "preserve": [{"id": a.id, "kind": a.kind, "staleness": a.staleness} for a in report.preserve],
        "note": report.note,
    }


@router.post("/{project_id}/dependencies/regenerate")
def regenerate(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    graph = get_graph(project_id)
    changed = ResourceRef(
        resource_id=body.get("resource_id", ""),
        kind=ResourceKind(body.get("kind", "text")),
        version=body.get("version", 1),
        source=body.get("source", ""),
    )
    report = impact_of(graph, changed)
    summary = regenerate_affected(graph, report)
    save_graph(graph)
    return summary


@router.post("/{project_id}/dependencies/undo")
def undo(project_id: str) -> dict[str, Any]:
    graph = get_graph(project_id)
    undone = undo_impact(graph)
    if undone is None:
        raise HTTPException(status_code=404, detail="no history to undo")
    save_graph(graph)
    return {"undone": undone}


def build_dependencies_router() -> APIRouter:
    return router
