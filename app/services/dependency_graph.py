"""Dependências explícitas e propagação de impacto (A26).

Modelo de grafo de produção: ResourceRef, Edge, ProjectGraph, impact_of,
regenerate_affected, undo_impact, persistência atômica.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a26_dependencies.py``.
"""

from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
import os
import tempfile
import warnings
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional


class ResourceKind(str, Enum):
    TEXT = "text"
    VOICE_REFERENCE = "voice_ref"
    SOUNDTRACK = "soundtrack"
    IMAGE_REFERENCE = "image_ref"
    LORA = "lora"
    MODEL = "model"
    PARAMETERS = "parameters"
    EDITORIAL = "editorial"


@dataclass(frozen=True)
class ResourceRef:
    resource_id: str
    kind: ResourceKind
    version: int = 1
    source: str = ""

    def key(self) -> str:
        return f"{self.kind.value}:{self.resource_id}:v{self.version}"


@dataclass(frozen=True)
class Edge:
    source: ResourceRef
    target_id: str
    target_kind: str
    relation: str = "uses"


@dataclass
class ArtifactId:
    id: str
    kind: str
    staleness: str = "fresh"


@dataclass
class ImpactReport:
    changed: ResourceRef
    affected: list[ArtifactId]
    preserve: list[ArtifactId]
    note: str = ""


@dataclass
class ProjectGraph:
    project_id: str
    edges: list[Edge] = field(default_factory=list)
    approved: set[str] = field(default_factory=set)
    history: list[dict[str, Any]] = field(default_factory=list)

    def add_edge(self, edge: Edge) -> None:
        self.edges.append(edge)

    def targets_for(self, resource_key: str) -> list[Edge]:
        return [e for e in self.edges if e.source.key() == resource_key]

    def is_approved(self, target_id: str) -> bool:
        return target_id in self.approved


def derive_resource_id(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def build_graph_from_shots(project_id: str, shots: list[dict[str, Any]]) -> ProjectGraph:
    graph = ProjectGraph(project_id=project_id)
    for shot in shots:
        shot_id = shot.get("shot_id", shot.get("id", ""))
        for char in shot.get("characters", []):
            for hand_key in ("left", "right"):
                obj_id = (char.get("hands") or {}).get(hand_key)
                if obj_id:
                    ref = ResourceRef(
                        resource_id=f"obj:{obj_id}",
                        kind=ResourceKind.IMAGE_REFERENCE,
                        version=char.get("wardrobe_version", 1),
                        source=f"shot_ir:{shot_id}:{hand_key}",
                    )
                    graph.add_edge(Edge(source=ref, target_id=shot_id, target_kind="take"))
            char_id = char.get("id")
            if char_id:
                ref = ResourceRef(
                    resource_id=f"char:{char_id}",
                    kind=ResourceKind.IMAGE_REFERENCE,
                    version=char.get("wardrobe_version", 1),
                    source=f"shot_ir:{shot_id}:character",
                )
                graph.add_edge(Edge(source=ref, target_id=shot_id, target_kind="take"))
        dialogue = shot.get("audio", {}).get("dialogue") if isinstance(shot.get("audio"), dict) else None
        if dialogue and isinstance(dialogue, str) and dialogue.strip():
            ref = ResourceRef(
                resource_id=derive_resource_id(dialogue),
                kind=ResourceKind.TEXT,
                source=f"shot_ir:{shot_id}:dialogue",
            )
            graph.add_edge(Edge(source=ref, target_id=shot_id, target_kind="take"))
        soundtrack = (shot.get("audio") or {}).get("music_segment") if isinstance(shot.get("audio"), dict) else None
        if soundtrack:
            ref = ResourceRef(
                resource_id=f"music:{soundtrack}",
                kind=ResourceKind.SOUNDTRACK,
                source=f"shot_ir:{shot_id}:music",
            )
            graph.add_edge(Edge(source=ref, target_id=shot_id, target_kind="take"))
        if shot.get("approved"):
            graph.approved.add(shot_id)
    return graph


def impact_of(graph: ProjectGraph, changed: ResourceRef) -> ImpactReport:
    affected: dict[str, ArtifactId] = {}
    direct_targets = graph.targets_for(changed.key())
    for e in direct_targets:
        affected[e.target_id] = ArtifactId(id=e.target_id, kind=e.target_kind, staleness="stale")
    seen_ids = set(affected.keys())
    queue = list(affected.keys())
    while queue:
        tid = queue.pop()
        for e in graph.edges:
            if e.source.resource_id == tid and e.target_id not in seen_ids:
                affected[e.target_id] = ArtifactId(id=e.target_id, kind=e.target_kind, staleness="stale")
                seen_ids.add(e.target_id)
                queue.append(e.target_id)

    all_target_ids = {e.target_id for e in graph.edges}
    preserve_ids = all_target_ids - seen_ids
    preserve = [
        ArtifactId(id=tid, kind="take", staleness="fresh")
        for tid in sorted(preserve_ids)
        if graph.is_approved(tid)
    ]
    report = ImpactReport(
        changed=changed,
        affected=sorted(affected.values(), key=lambda a: a.id),
        preserve=preserve,
        note=f"edges traversed: {len(graph.edges)}",
    )
    graph.history.append({
        "action": "impact_of",
        "changed": changed.key(),
        "affected_ids": [a.id for a in report.affected],
    })
    return report


def regenerate_affected(graph: ProjectGraph, report: ImpactReport) -> dict[str, Any]:
    summary = {
        "regenerated": [art.id for art in report.affected],
        "preserved_approved": [a.id for a in report.preserve],
        "blocked_by_dependencies": [],
    }
    graph.history.append({
        "action": "regenerate",
        "affected_ids": [a.id for a in report.affected],
        "preserved_ids": [a.id for a in report.preserve],
    })
    return summary


def undo_impact(graph: ProjectGraph) -> dict[str, Any] | None:
    if not graph.history:
        return None
    last = graph.history.pop()
    return last


def _default_graph_path(project_id: str) -> Path:
    cache_dir = Path(os.environ.get("APP_CACHE_DIR", "")) if os.environ.get("APP_CACHE_DIR") else None
    if cache_dir is None:
        cache_dir = Path(__file__).resolve().parents[1] / ".cache"
    return cache_dir / "dependency_graphs" / f"{project_id}.json"


def save_graph_atomic(graph: ProjectGraph, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": "1.0",
        "project_id": graph.project_id,
        "edges": [
            {
                "source_kind": e.source.kind.value,
                "source_id": e.source.resource_id,
                "source_version": e.source.version,
                "source_str": e.source.source,
                "target_id": e.target_id,
                "target_kind": e.target_kind,
                "relation": e.relation,
            }
            for e in graph.edges
        ],
        "approved": sorted(graph.approved),
        "history": graph.history[-20:],
    }
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_graph(path: Path) -> ProjectGraph:
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "1.0":
        import warnings
        warnings.warn(f"schema_version={payload.get('schema_version')} desconhecida", stacklevel=2)
    graph = ProjectGraph(project_id=payload["project_id"])
    for e in payload.get("edges", []):
        ref = ResourceRef(
            resource_id=e["source_id"],
            kind=ResourceKind(e["source_kind"]),
            version=e.get("source_version", 1),
            source=e.get("source_str", ""),
        )
        graph.add_edge(Edge(source=ref, target_id=e["target_id"], target_kind=e["target_kind"], relation=e.get("relation", "uses")))
    graph.approved = set(payload.get("approved", []))
    graph.history = payload.get("history", [])
    return graph


def get_graph(project_id: str) -> ProjectGraph:
    path = _default_graph_path(project_id)
    g = load_graph(path)
    if g is None:
        g = ProjectGraph(project_id=project_id)
    return g


def save_graph_atomic(graph: ProjectGraph, path: Path) -> None:
    """Persiste o grafo atomicamente no caminho fornecido."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": "1.0",
        "project_id": graph.project_id,
        "edges": [
            {
                "source_kind": e.source.kind.value,
                "source_id": e.source.resource_id,
                "source_version": e.source.version,
                "source_str": e.source.source,
                "target_id": e.target_id,
                "target_kind": e.target_kind,
                "relation": e.relation,
            }
            for e in graph.edges
        ],
        "approved": sorted(graph.approved),
        "history": graph.history[-20:],
    }
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def save_graph(graph: ProjectGraph) -> Path:
    path = _default_graph_path(graph.project_id)
    save_graph_atomic(graph, path)
    return path
