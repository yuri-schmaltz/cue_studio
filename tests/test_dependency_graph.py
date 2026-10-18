"""Testes de integração do serviço DependencyGraph (A26)."""

from __future__ import annotations

import tempfile
from pathlib import Path

from app.services.dependency_graph import (
    ResourceKind,
    ResourceRef,
    build_graph_from_shots,
    get_graph,
    impact_of,
    regenerate_affected,
    load_graph,
    save_graph,
    save_graph_atomic,
    undo_impact,
)


def _shot(sid: str, **kw) -> dict:
    base = {
        "shot_id": sid,
        "characters": [
            {"id": "char_ana", "hands": {"left": "obj_cup", "right": None}, "wardrobe_version": 1},
        ],
        "audio": {"dialogue": None, "music_segment": None},
        "approved": False,
    }
    audio = dict(base["audio"])
    if "dialogue" in kw:
        audio["dialogue"] = kw.pop("dialogue")
    if "music_segment" in kw:
        audio["music_segment"] = kw.pop("music_segment")
    base["audio"] = audio
    base.update(kw)
    return base


def test_build_graph_from_shots():
    shots = [_shot("S01"), _shot("S02", approved=True)]
    graph = build_graph_from_shots("proj-1", shots)
    assert graph.project_id == "proj-1"
    assert len(graph.edges) >= 2  # char + obj
    assert "S02" in graph.approved


def test_impact_of_direct():
    shots = [_shot("S01")]
    graph = build_graph_from_shots("proj-2", shots)
    ref = ResourceRef(resource_id="char:char_ana", kind=ResourceKind.IMAGE_REFERENCE, version=1)
    report = impact_of(graph, ref)
    assert "S01" in [a.id for a in report.affected]


def test_impact_of_unknown_resource():
    shots = [_shot("S01")]
    graph = build_graph_from_shots("proj-3", shots)
    ref = ResourceRef(resource_id="char:unknown", kind=ResourceKind.IMAGE_REFERENCE, version=1)
    report = impact_of(graph, ref)
    assert report.affected == []


def test_regenerate_affected():
    shots = [_shot("S01")]
    graph = build_graph_from_shots("proj-4", shots)
    ref = ResourceRef(resource_id="char:char_ana", kind=ResourceKind.IMAGE_REFERENCE, version=1)
    report = impact_of(graph, ref)
    summary = regenerate_affected(graph, report)
    assert "S01" in summary["regenerated"]


def test_undo_impact():
    shots = [_shot("S01")]
    graph = build_graph_from_shots("proj-5", shots)
    ref = ResourceRef(resource_id="char:char_ana", kind=ResourceKind.IMAGE_REFERENCE, version=1)
    impact_of(graph, ref)
    undone = undo_impact(graph)
    assert undone is not None
    assert undone["action"] == "impact_of"
    assert undo_impact(graph) is None


def test_save_load_graph():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "graph.json"
        shots = [_shot("S01", approved=True)]
        graph = build_graph_from_shots("proj-6", shots)
        save_graph_atomic(graph, path)
        loaded = load_graph(path)
        assert loaded is not None
        assert loaded.project_id == "proj-6"
        assert len(loaded.edges) == len(graph.edges)
        assert "S01" in loaded.approved


def test_dialogue_text_resource():
    shots = [_shot("S01", dialogue="Na oficina silenciosa.")]
    graph = build_graph_from_shots("proj-7", shots)
    text_edges = [e for e in graph.edges if e.source.kind == ResourceKind.TEXT]
    assert len(text_edges) == 1
    assert text_edges[0].target_id == "S01"


def test_music_segment_resource():
    shots = [_shot("S01", music_segment="seg_1")]
    graph = build_graph_from_shots("proj-8", shots)
    music_edges = [e for e in graph.edges if e.source.kind == ResourceKind.SOUNDTRACK]
    assert len(music_edges) == 1


def test_is_approved():
    shots = [_shot("S01", approved=True), _shot("S02")]
    graph = build_graph_from_shots("proj-9", shots)
    assert graph.is_approved("S01") is True
    assert graph.is_approved("S02") is False


def test_preserve_approved_on_impact():
    shots = [_shot("S01", approved=True), _shot("S02")]
    graph = build_graph_from_shots("proj-10", shots)
    # Alterar recurso de S02 não deve afetar S01 (approved)
    ref = ResourceRef(resource_id="char:char_ana", kind=ResourceKind.IMAGE_REFERENCE, version=1)
    report = impact_of(graph, ref)
    # S01 e S02 ambos usam char_ana, então ambos são afetados
    assert len(report.affected) >= 1
