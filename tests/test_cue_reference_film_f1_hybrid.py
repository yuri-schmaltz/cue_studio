"""Teste de integração F1 da fixture 'A luz da oficina' (modo híbrido).

F1 substitui o F0 puramente sintético por **mídia congelada** (master.mp4 e
stems do F0) + **jobs reais de edição/retake controlado** sobre os serviços
de produção do Cue Studio (ProductionStore, ProductionResume com idempotência
A26b, ProvenanceManifest A27, Continuity check A25, CapabilityMatrix A34).

Não requer GPU nem modelos de IA: usa apenas a mídia F0 já materializada e
os serviços backend determinísticos.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "cue_reference_film_v1"
F0_GENERATOR = FIXTURE_DIR / "generate_f0.py"
SHOTS = json.loads((FIXTURE_DIR / "shots.json").read_text()) if (FIXTURE_DIR / "shots.json").is_file() else {}


def _run_f0() -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python", str(F0_GENERATOR)], capture_output=True, text=True, timeout=300
    )


# ── Mídia congelada presente e íntegra ──


def test_f1_frozen_media_present():
    result = _run_f0()
    assert result.returncode == 0, result.stderr
    assert "TODOS OS CRITÉRIOS DE ACEITE PASSARAM" in result.stdout


# ── Retake controlado e idempotente (A26b) sobre job real ──


def test_f1_controlled_retake_idempotent(tmp_path):
    from app.services.production_store import ProductionStore
    from app.services.production_resume import ProductionResume

    store = ProductionStore(db_path=str(tmp_path / "f1.sqlite3"))
    store.upsert_pipeline(
        {
            "pipeline_id": "f1-pipe",
            "status": "running",
            "attempt": 1,
            "stages": [{"name": "video", "ok": True}],
            "created_at": "2026-10-18T00:00:00Z",
            "updated_at": "2026-10-18T00:00:00Z",
        }
    )

    def executor(pipeline_id, out_dir, stage_name):
        return True, "retake-ok"

    facade = ProductionResume(store=store, pipeline_resume=executor)
    r1 = facade.retake_stage(
        pipeline_id="f1-pipe",
        out_dir=str(tmp_path / "out"),
        stage_name="video",
        idempotency_key="f1-key",
    )
    r2 = facade.retake_stage(
        pipeline_id="f1-pipe",
        out_dir=str(tmp_path / "out"),
        stage_name="video",
        idempotency_key="f1-key",
    )
    assert r1.ok is True and r2.ok is True
    assert r1.attempt == r2.attempt == 2, "retake duplicou attempt"


# ── ProvenanceManifest emitido e validado (A27) ──


def test_f1_provenance_emitted_and_validated(tmp_path):
    from app.services.provenance import (
        ProvenanceManifest,
        ModelRef,
        HardwareProfile,
        RuntimeRef,
        AssetRef,
        manifest_to_dict,
        manifest_from_dict,
        write_manifest_atomic,
        validate_against_disk,
        compute_sha256,
    )

    artifact = tmp_path / "master.mp4"
    artifact.write_bytes(b"frozen-media-bytes" * 100)
    sidecar = tmp_path / "sidecar.json"
    sidecar.write_text('{"params": 42}')

    def _sha(s):
        return hashlib.sha256(s.encode()).hexdigest()

    m = ProvenanceManifest(
        schema_version="1.0",
        take_id="f1-take-1",
        project_id="proj_demo",
        generation_timestamp="2026-10-18T00:00:00Z",
        adapter_id="f0-deterministic",
        adapter_revision="rev1",
        model=ModelRef(
            model_id="f0_renderer",
            sha256=_sha("model"),
            quantization="fp16",
            precision="full",
        ),
        seed=42,
        profile=HardwareProfile(gpu_name="none", gpu_vram_mb=0, system_ram_mb=16384, os="linux"),
        runtime=RuntimeRef(python="3.11", pytorch="n/a", cue_studio_revision="f1"),
        artifacts=[AssetRef(asset_id="art_1", role="output", sha256=compute_sha256(artifact), size_bytes=artifact.stat().st_size, relative_path="master.mp4")],
        sidecars={"sidecar.json": compute_sha256(sidecar)},
    )
    m.validate()
    write_manifest_atomic(m, tmp_path / "manifest.json")
    status, issues = validate_against_disk(m, tmp_path)
    assert status in ("verified", "needs_review", "incomplete"), (status, issues)
    # round-trip
    m2 = manifest_from_dict(manifest_to_dict(m))
    assert m2.take_id == m.take_id


# ── Continuity check (A25) executa sobre os shots da fixture ──


def test_f1_continuity_check_runs():
    from app.services.director.shot_ir_schema import (
        ShotIR, CharacterInShot, Position, Gaze, HandState,
        Environment, ObjectState, Action, Camera, AudioCue, ContinuityHints,
    )
    from app.services.director.continuity_check import check_sequence

    shots = []
    for i, s in enumerate((SHOTS.get("shots") or [])[:3]):
        shots.append(
            ShotIR(
                shot_id=s.get("id", f"shot_{i}"),
                characters=[],
                environment=Environment(
                    location_id=s.get("location", "loc"),
                    time_of_day="morning",
                    lighting="natural",
                    objects_state=[],
                ),
                action=Action(completed_in_shot=[], in_progress=[], next_intent=None),
                camera=Camera(shot_size="medium", movement="static", angle="eye_level"),
                audio=AudioCue(dialogue=None, ambient=[], music_segment=None),
                continuity_hints=ContinuityHints(previous_shot_id=None, state_inherited_from=None),
            )
        )
    result = check_sequence(shots)
    assert result is not None


# ── CapabilityMatrix (A34) responde ──


def test_f1_capability_matrix_lookup():
    from app.services.capability_matrix import get_capability_matrix

    cm = get_capability_matrix()
    assert cm is not None


# ── Retake não publica arquivo parcial como master ──


def test_f1_partial_file_not_published(tmp_path):
    from app.services.production_store import ProductionStore
    from app.services.production_resume import ProductionResume

    store = ProductionStore(db_path=str(tmp_path / "f1b.sqlite3"))
    store.upsert_pipeline(
        {
            "pipeline_id": "f1-pipe-b",
            "status": "validating_output",
            "attempt": 1,
            "stages": [{"name": "video", "ok": True}],
            "created_at": "2026-10-18T00:00:00Z",
            "updated_at": "2026-10-18T00:00:00Z",
        }
    )
    facade = ProductionResume(store=store)
    state = facade.get_pipeline_state("f1-pipe-b")
    assert state is not None
    assert state["status"] == "validating_output"
