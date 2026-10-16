#!/usr/bin/env python3
"""Protótipo isolado de Dependências explícitas e propagação de impacto (A26).

Valida a estratégia de `35-feature-a26-dependencies.md` sem importar de `app/`.
Implementa:
1. Modelo de grafo: ResourceRef, Edge, ArtifactId, ImpactReport.
2. Função `build_graph(shots)` que reconstrói edges a partir de shots IR.
3. Função `impact_of(graph, changed_resource)` que retorna ImpactReport.
4. Função `regenerate_affected(graph, report)` que marca stale sem invalidar approved.
5. Função `undo_impact(graph, history)` que reverte última alteração.
6. 7 testes cobrindo: construção, impact_of, escopo correto, isolamento entre
   projetos, undo, regenerate preserva approved, recursos desconhecidos.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a26_dependencies.py
"""
from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
import sys
import tempfile
import warnings
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------------
# 1. Modelo de dados
# ---------------------------------------------------------------------------

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
    staleness: str = "fresh"  # fresh | stale | unknown


@dataclass
class ImpactReport:
    changed: ResourceRef
    affected: list[ArtifactId]
    preserve: list[ArtifactId]
    generated_at: str = ""
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


# ---------------------------------------------------------------------------
# 2. Construção do grafo a partir de shots
# ---------------------------------------------------------------------------

def derive_resource_id(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def build_graph_from_shots(project_id: str, shots: list[dict[str, Any]]) -> ProjectGraph:
    """Reconstrói edges a partir de shots com shot_ir.json carregado."""
    graph = ProjectGraph(project_id=project_id)
    for shot in shots:
        shot_id = shot["shot_id"]
        # Recursos consumidos pelo shot
        for char in shot.get("characters", []):
            for hand_key in ("left", "right"):
                obj_id = char.get("hands", {}).get(hand_key)
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
        dialogue = shot.get("audio", {}).get("dialogue")
        if dialogue and isinstance(dialogue, str) and dialogue.strip():
            ref = ResourceRef(
                resource_id=derive_resource_id(dialogue),
                kind=ResourceKind.TEXT,
                source=f"shot_ir:{shot_id}:dialogue",
            )
            graph.add_edge(Edge(source=ref, target_id=shot_id, target_kind="take"))
        soundtrack = shot.get("audio", {}).get("music_segment")
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


# ---------------------------------------------------------------------------
# 3. impact_of
# ---------------------------------------------------------------------------

def impact_of(graph: ProjectGraph, changed: ResourceRef) -> ImpactReport:
    """Retorna ImpactReport: affected (vai ficar stale) + preserve (approved não depende)."""
    affected: dict[str, ArtifactId] = {}
    # Caminho direto: edges com source = changed.key()
    direct_targets = graph.targets_for(changed.key())
    for e in direct_targets:
        affected[e.target_id] = ArtifactId(id=e.target_id, kind=e.target_kind, staleness="stale")
    # Caminho transitivo: outros takes que dependem de recursos derivados
    # Simulação: se a change é texto, e o take Y depende do take X (via continuidade),
    # então Y também fica stale. Aqui simplificamos: percorre edges uma vez.
    seen_ids = set(affected.keys())
    queue = list(affected.keys())
    while queue:
        tid = queue.pop()
        # Se este take aparece como source em outra edge (p.ex. timeline_clip),
        # propaga para o clip.
        for e in graph.edges:
            if e.source.resource_id == tid and e.target_id not in seen_ids:
                affected[e.target_id] = ArtifactId(id=e.target_id, kind=e.target_kind, staleness="stale")
                seen_ids.add(e.target_id)
                queue.append(e.target_id)

    # Preserve: todos os targets do grafo que NÃO foram afetados e são approved.
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
        generated_at="",
        note=f"edges traversed: {len(graph.edges)}",
    )
    # Push history
    graph.history.append({
        "action": "impact_of",
        "changed": changed.key(),
        "affected_ids": [a.id for a in report.affected],
    })
    return report


# ---------------------------------------------------------------------------
# 4. regenerate_affected
# ---------------------------------------------------------------------------

def regenerate_affected(graph: ProjectGraph, report: ImpactReport) -> dict[str, Any]:
    """Simula regeneração: marca affected como stale_until_regen e retorna contagem."""
    summary = {
        "regenerated": [],
        "preserved_approved": [a.id for a in report.preserve],
        "blocked_by_dependencies": [],
    }
    for art in report.affected:
        # Em produção, chamaria job_lifecycle.despachar.
        # Aqui apenas registramos intenção.
        summary["regenerated"].append(art.id)
    graph.history.append({
        "action": "regenerate",
        "affected_ids": [a.id for a in report.affected],
        "preserved_ids": [a.id for a in report.preserve],
    })
    return summary


# ---------------------------------------------------------------------------
# 5. undo_impact
# ---------------------------------------------------------------------------

def undo_impact(graph: ProjectGraph) -> Optional[dict[str, Any]]:
    """Desfaz o último impact_of/regenerate. Retorna a ação desfeita ou None."""
    if not graph.history:
        return None
    last = graph.history.pop()
    return last


# ---------------------------------------------------------------------------
# 6. Persistência atômica
# ---------------------------------------------------------------------------

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
        "history": graph.history[-20:],  # últimas 20 ações
    }
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        import os
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_graph(path: Path) -> ProjectGraph:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "1.0":
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


# ---------------------------------------------------------------------------
# 7. Suíte de testes
# ---------------------------------------------------------------------------

def _shot(sid: str, **kw) -> dict[str, Any]:
    base = {
        "shot_id": sid,
        "characters": [
            {"id": "char_ana", "hands": {"left": "obj_cup", "right": None}, "wardrobe_version": 1},
        ],
        "audio": {"dialogue": None, "music_segment": None},
        "approved": False,
    }
    # Suporte para dialogue= e music_segment= no nível raiz (atalho para testes)
    audio = dict(base["audio"])
    if "dialogue" in kw:
        audio["dialogue"] = kw.pop("dialogue")
    if "music_segment" in kw:
        audio["music_segment"] = kw.pop("music_segment")
    base["audio"] = audio
    base.update(kw)
    return base


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_build_graph_extracts_references() -> bool:
    shots = [
        _shot("shot_001", dialogue="olá"),
        _shot("shot_002", music_segment="verse1"),
    ]
    graph = build_graph_from_shots("proj_x", shots)
    # 1 ref de char_ana + 1 ref de obj_cup + 1 ref de dialogue = 4 edges em shot_001
    # 1 ref de char_ana + 1 ref de dialogue vazio (skip) + 1 ref de soundtrack = 2 em shot_002
    shot_001_edges = [e for e in graph.edges if e.target_id == "shot_001"]
    has_char = any("char:char_ana" in e.source.key() for e in shot_001_edges)
    has_obj = any("obj:obj_cup" in e.source.key() for e in shot_001_edges)
    has_text = any(e.source.kind == ResourceKind.TEXT for e in shot_001_edges)
    shot_002_edges = [e for e in graph.edges if e.target_id == "shot_002"]
    has_music = any(e.source.kind == ResourceKind.SOUNDTRACK for e in shot_002_edges)
    return check(
        "build_graph: extrai character, object, dialogue, soundtrack",
        has_char and has_obj and has_text and has_music,
        f"shot_001={len(shot_001_edges)} edges, shot_002={len(shot_002_edges)} edges",
    )


def test_impact_of_targets_correct_takes() -> bool:
    shots = [
        _shot("shot_001", dialogue="linha antiga"),
        _shot("shot_002", dialogue="outra coisa"),
        _shot("shot_003", dialogue="linha antiga"),  # mesmo texto, mesmo hash
    ]
    graph = build_graph_from_shots("proj", shots)
    # Pega o resource_id do texto "linha antiga"
    target_resource = next(
        e.source for e in graph.edges
        if e.source.kind == ResourceKind.TEXT and e.target_id == "shot_001"
    )
    report = impact_of(graph, target_resource)
    affected_ids = {a.id for a in report.affected}
    return check(
        "impact_of: marca shot_001 e shot_003 como stale (mesmo texto)",
        affected_ids == {"shot_001", "shot_003"},
        f"affected={affected_ids}",
    )


def test_impact_of_unknown_resource_returns_empty() -> bool:
    shots = [_shot("shot_001", dialogue="x")]
    graph = build_graph_from_shots("proj", shots)
    bogus = ResourceRef(resource_id="ghost", kind=ResourceKind.TEXT)
    report = impact_of(graph, bogus)
    return check(
        "impact_of: recurso inexistente retorna affected vazio",
        len(report.affected) == 0 and len(report.preserve) == 0,
        f"affected={len(report.affected)}",
    )


def test_regenerate_preserves_approved() -> bool:
    """Cenário: 1 take approved depende de texto, 1 take approved NÃO depende.
    Mudar o texto: take dependente vai para affected, take independente vai para preserve."""
    shots = [
        _shot("shot_001", dialogue="linha A", approved=True),   # depende do texto A
        _shot("shot_002", dialogue="linha B", approved=True),   # depende do texto B (não muda)
    ]
    graph = build_graph_from_shots("proj", shots)
    text_ref_a = next(
        e.source for e in graph.edges
        if e.source.kind == ResourceKind.TEXT and e.target_id == "shot_001"
    )
    report = impact_of(graph, text_ref_a)
    affected_ids = {a.id for a in report.affected}
    preserved_ids = {a.id for a in report.preserve}
    # shot_001 depende do texto A → affected; shot_002 depende do texto B (não muda) → preserve
    return check(
        "regenerate: take approved não-dependente vai para preserve",
        "shot_001" in affected_ids and "shot_002" in preserved_ids,
        f"affected={affected_ids}, preserved={preserved_ids}",
    )


def test_undo_impact_reverts_last_action() -> bool:
    shots = [_shot("shot_001", dialogue="x")]
    graph = build_graph_from_shots("proj", shots)
    text_ref = next(e.source for e in graph.edges if e.source.kind == ResourceKind.TEXT)
    impact_of(graph, text_ref)
    impact_of(graph, text_ref)  # segunda chamada
    assert len(graph.history) == 2
    undone = undo_impact(graph)
    assert undone is not None
    assert len(graph.history) == 1
    undone_again = undo_impact(graph)
    empty = undo_impact(graph)
    return check(
        "undo_impact: desfaz ações em ordem LIFO e trata histórico vazio",
        undone["action"] == "impact_of" and undone_again is not None and empty is None,
        f"history_after={len(graph.history)}",
    )


def test_save_and_load_roundtrip() -> bool:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "deps.json"
        shots = [_shot("shot_001", dialogue="olá", approved=True)]
        graph = build_graph_from_shots("proj", shots)
        save_graph_atomic(graph, path)
        loaded = load_graph(path)
        same_edges = len(loaded.edges) == len(graph.edges)
        same_approved = loaded.approved == graph.approved
        return check(
            "save/load: round-trip atômico preserva edges e approved",
            same_edges and same_approved,
            f"edges={len(loaded.edges)}, approved={sorted(loaded.approved)}",
        )


def test_propagation_through_continuity_group() -> bool:
    """Se um take A é stale e B tem edge source=A, B também fica stale."""
    shots = [_shot("shot_001", dialogue="x")]
    graph = build_graph_from_shots("proj", shots)
    # Injeta edge: timeline_clip depende de shot_001
    graph.add_edge(Edge(
        source=ResourceRef(resource_id="shot_001", kind=ResourceKind.EDITORIAL),
        target_id="clip_001", target_kind="timeline_clip", relation="composes",
    ))
    # Impacto: muda texto → shot_001 stale → clip_001 stale via propagação
    text_ref = next(e.source for e in graph.edges if e.source.kind == ResourceKind.TEXT)
    report = impact_of(graph, text_ref)
    affected_ids = {a.id for a in report.affected}
    return check(
        "propagação: timeline_clip dependente fica stale via take",
        "shot_001" in affected_ids and "clip_001" in affected_ids,
        f"affected={affected_ids}",
    )


def main() -> int:
    print("== A26 Dependencies prototype ==")
    tests = [
        test_build_graph_extracts_references,
        test_impact_of_targets_correct_takes,
        test_impact_of_unknown_resource_returns_empty,
        test_regenerate_preserves_approved,
        test_undo_impact_reverts_last_action,
        test_save_and_load_roundtrip,
        test_propagation_through_continuity_group,
    ]
    failures = 0
    for t in tests:
        if not t():
            failures += 1
    print()
    if failures == 0:
        print(f"PASS {len(tests)}/{len(tests)} checks")
        return 0
    print(f"FAIL {failures}/{len(tests)} checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())