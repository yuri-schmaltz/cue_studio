"""A27 — schema, SHA-256, validação (com detecção de adulteração) e retrofill."""
from __future__ import annotations

import hashlib
import json
import warnings

import pytest

from app.services.provenance import (
    AssetRef,
    HardwareProfile,
    LoRARef,
    ModelRef,
    ProvenanceManifest,
    ProvenanceValidationError,
    RuntimeRef,
    ValidationStatus,
    asset_ref_from_path,
    compute_sha256,
    default_hardware_profile,
    default_runtime_ref,
    emit_provenance,
    find_takes_using,
    load_manifest,
    manifest_from_dict,
    manifest_to_dict,
    retrofill_manifest,
    validate_manifest,
    write_manifest_atomic,
)


def _write(path, data: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return str(path)


def _make_manifest(tmp_path, *, tamper_target: str | None = None) -> ProvenanceManifest:
    output = tmp_path / "shot_001.mp4"
    _write(output, b"FAKE OUTPUT VIDEO BYTES " * 1024)
    sidecar = tmp_path / "shot_001.meta.json"
    _write(sidecar, b'{"generation_mode":"video","tool":"studio"}')
    weights = tmp_path / "_weights" / "model.safetensors"
    _write(weights, b"MODEL_WEIGHTS " * 2048)
    return ProvenanceManifest(
        take_id="take_001",
        project_id="proj_demo",
        generation_timestamp="2026-10-18T00:00:00+00:00",
        adapter_id="h3_omni_pruned",
        adapter_revision="5b37a5d",
        model=ModelRef(
            model_id="model_h3_pruned_20b",
            sha256=compute_sha256(weights),
            quantization="int8",
            precision="pruned",
        ),
        seed=148920,
        profile=HardwareProfile(
            gpu_name="NVIDIA RTX 4090",
            gpu_vram_mb=24576,
            system_ram_mb=65536,
            os="linux",
            cuda_version="13.0",
        ),
        runtime=RuntimeRef(
            python="3.11.14",
            pytorch="2.10.0",
            cuda="13.0",
            cue_studio_revision="5b37a5d",
        ),
        artifacts=[
            AssetRef(
                asset_id="asset_out_001",
                role="output",
                sha256=compute_sha256(output),
                size_bytes=output.stat().st_size,
                relative_path="shot_001.mp4",
            ),
        ],
        sidecars={"shot_001.meta.json": compute_sha256(sidecar)},
        parameters={"steps": 30, "guidance": 7.0, "seed": 148920},
    )


# ------------------------------------------------------------------
# Schema
# ------------------------------------------------------------------

def test_valid_manifest_passes(tmp_path):
    _make_manifest(tmp_path).validate()


def test_manifest_rejects_bad_sha256():
    with pytest.raises(ProvenanceValidationError):
        ModelRef("m", "abc", "fp16", "full").validate()


def test_manifest_rejects_bad_quantization():
    with pytest.raises(ProvenanceValidationError):
        ModelRef("m", "0" * 64, "int3", "full").validate()


def test_lora_strength_bounds():
    with pytest.raises(ProvenanceValidationError):
        LoRARef("l", "0" * 64, 2.5).validate()
    LoRARef("l", "0" * 64, 1.0).validate()


def test_asset_role_enum_enforced():
    with pytest.raises(ProvenanceValidationError):
        AssetRef("a", "mystery", "0" * 64, 1, "x.mp4").validate()


def test_unknown_schema_version_warns_but_loads(tmp_path):
    manifest = _make_manifest(tmp_path)
    payload = manifest_to_dict(manifest)
    payload["schema_version"] = "2.0"
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        loaded = manifest_from_dict(payload)
    assert loaded.take_id == "take_001"
    assert any("schema_version" in str(w.message) for w in caught)


def test_manifest_round_trip_preserves_fields(tmp_path):
    manifest = _make_manifest(tmp_path)
    restored = manifest_from_dict(manifest_to_dict(manifest))
    assert restored.take_id == manifest.take_id
    assert restored.model.sha256 == manifest.model.sha256
    assert restored.artifacts[0].relative_path == "shot_001.mp4"
    assert restored.sidecars == manifest.sidecars


# ------------------------------------------------------------------
# SHA-256
# ------------------------------------------------------------------

def test_compute_sha256_matches_hashlib(tmp_path):
    path = tmp_path / "blob.bin"
    _write(path, b"hello provenance")
    expected = hashlib.sha256(b"hello provenance").hexdigest()
    assert compute_sha256(path) == expected
    assert len(compute_sha256(path)) == 64


def test_asset_ref_from_path_hashes_real_bytes(tmp_path):
    path = tmp_path / "ref.png"
    _write(path, b"PNGDATA" * 100)
    ref = asset_ref_from_path(
        path, asset_id="ref_1", role="reference_image", project_dir=tmp_path,
    )
    assert ref.sha256 == compute_sha256(path)
    assert ref.size_bytes == path.stat().st_size
    assert ref.relative_path == "ref.png"


# ------------------------------------------------------------------
# Validação contra disco (inclui detecção de adulteração)
# ------------------------------------------------------------------

def test_validate_verified_when_everything_matches(tmp_path):
    manifest = _make_manifest(tmp_path)
    status, issues = validate_manifest(manifest, tmp_path)
    assert status is ValidationStatus.VERIFIED
    assert issues == []


def test_validate_detects_tampered_artifact(tmp_path):
    manifest = _make_manifest(tmp_path)
    (tmp_path / "shot_001.mp4").write_bytes(b"ADULTERATED " * 1024)
    status, issues = validate_manifest(manifest, tmp_path)
    assert status is ValidationStatus.CORRUPT
    assert any("adulterado" in issue for issue in issues)


def test_validate_detects_tampered_sidecar(tmp_path):
    manifest = _make_manifest(tmp_path)
    (tmp_path / "shot_001.meta.json").write_bytes(b'{"tampered":true}')
    status, issues = validate_manifest(manifest, tmp_path)
    assert status is ValidationStatus.CORRUPT


def test_validate_detects_missing_artifact(tmp_path):
    manifest = _make_manifest(tmp_path)
    (tmp_path / "shot_001.mp4").unlink()
    status, issues = validate_manifest(manifest, tmp_path)
    assert status is ValidationStatus.INCOMPLETE
    assert any("ausente" in issue for issue in issues)


def test_validate_detects_missing_weights(tmp_path):
    manifest = _make_manifest(tmp_path)
    # Move o peso do modelo (simula outra máquina).
    import shutil

    shutil.move(
        str(tmp_path / "_weights" / "model.safetensors"),
        str(tmp_path / "_weights" / "moved.safetensors"),
    )
    # O manifesto A27 valida artefatos/sidecars; pesos só entram via
    # references quando declarados como AssetRef.
    manifest.references.append(
        AssetRef(
            asset_id="model_weights",
            role="checkpoint",
            sha256=manifest.model.sha256,
            size_bytes=1,
            relative_path="_weights/model.safetensors",
        )
    )
    status, issues = validate_manifest(manifest, tmp_path)
    assert status is ValidationStatus.INCOMPLETE


# ------------------------------------------------------------------
# Emissão e retrofill
# ------------------------------------------------------------------

def test_emit_provenance_writes_manifest_beside_output(tmp_path):
    output = tmp_path / "take_a.mp4"
    _write(output, b"OUTPUT BYTES" * 500)
    sidecar = tmp_path / "take_a.meta.json"
    _write(sidecar, b'{"tool":"studio"}')
    manifest = emit_provenance(
        take_id="take_a",
        output_path=output,
        project_id="proj",
        adapter_id="h3_omni_pruned",
        sidecar_paths=[sidecar],
        seed=7,
    )
    written = tmp_path / "take_a.provenance.json"
    assert written.is_file()
    loaded = load_manifest(written)
    assert loaded.take_id == "take_a"
    assert loaded.seed == 7
    assert loaded.artifacts[0].sha256 == compute_sha256(output)
    assert manifest.sidecars["take_a.meta.json"] == compute_sha256(sidecar)


def test_emit_with_model_path_hashes_weights(tmp_path):
    output = tmp_path / "take_b.mp4"
    _write(output, b"OUT" * 100)
    weights = tmp_path / "w.safetensors"
    _write(weights, b"W" * 4096)
    manifest = emit_provenance(
        take_id="take_b",
        output_path=output,
        model_path=weights,
        write=False,
    )
    assert manifest.model.sha256 == compute_sha256(weights)


def test_retrofill_from_legacy_sidecar(tmp_path):
    output = tmp_path / "old.mp4"
    _write(output, b"OLD OUTPUT " * 10)
    sidecar = tmp_path / "old.meta.json"
    _write(
        sidecar,
        b'{"generation_mode":"video","tool":"studio","params":{"seed":42,"model_type":"ltx25_distilled"}}',
    )
    manifest = retrofill_manifest(output, project_dir=tmp_path)
    assert manifest.take_id == "old"
    assert manifest.seed == 42
    assert manifest.adapter_id == "ltx25_distilled"
    status, issues = validate_manifest(manifest, tmp_path)
    assert status is ValidationStatus.VERIFIED


def test_retrofill_without_sidecar_still_valid(tmp_path):
    output = tmp_path / "lonely.mp4"
    _write(output, b"NO SIDECAR" * 5)
    manifest = retrofill_manifest(output, project_dir=tmp_path)
    assert manifest.adapter_id == "legacy_unknown"
    manifest.validate()


def test_default_profile_and_runtime_are_sane():
    profile = default_hardware_profile()
    profile.validate()
    runtime = default_runtime_ref()
    assert runtime.python.count(".") == 2


# ------------------------------------------------------------------
# Query reversa (Storage Manager)
# ------------------------------------------------------------------

def test_find_takes_using_shared_model(tmp_path):
    project = tmp_path / "proj1"
    project.mkdir()
    weights = project / "_weights" / "shared.safetensors"
    _write(weights, b"SHARED WEIGHTS " * 1024)
    shared_sha = compute_sha256(weights)

    for take, name in (("take_001", "shot_a"), ("take_002", "shot_b")):
        output = project / f"{name}.mp4"
        _write(output, f"OUT {take} ".encode() + b" " * 100)
        sidecar = project / f"{name}.meta.json"
        _write(sidecar, b'{"tool":"studio"}')
        emit_provenance(
            take_id=take,
            output_path=output,
            project_id="proj_demo",
            model=ModelRef("m", shared_sha, "int8", "pruned"),
            sidecar_paths=[sidecar],
        )

    found = find_takes_using(shared_sha, tmp_path)
    assert {m.take_id for m in found} == {"take_001", "take_002"}


def test_find_takes_using_ignores_corrupt_manifests(tmp_path):
    bad = tmp_path / "broken.provenance.json"
    bad.write_text("{not json", encoding="utf-8")
    assert find_takes_using("0" * 64, tmp_path) == []


def test_write_and_load_manifest_atomic(tmp_path):
    manifest = _make_manifest(tmp_path)
    path = tmp_path / "m.provenance.json"
    write_manifest_atomic(manifest, path)
    assert path.is_file()
    assert not [p for p in tmp_path.iterdir() if p.suffix == ".tmp"]
    assert load_manifest(path).take_id == "take_001"


def test_load_manifest_rejects_corrupt_json(tmp_path):
    path = tmp_path / "bad.provenance.json"
    path.write_text("{oops", encoding="utf-8")
    with pytest.raises(ProvenanceValidationError):
        load_manifest(path)


def test_emit_for_job_snapshot_end_to_end(tmp_path):
    """Hook do job_lifecycle: manifest emitido para cada output do Take."""
    from app.services.job_lifecycle import emit_provenance_for_job

    out_dir = tmp_path / "outputs"
    _write(out_dir / "clip_001.mp4", b"CLIP BYTES " * 200)
    _write(out_dir / "clip_001.meta.json", b'{"tool":"studio"}')
    gen = {
        "id": "job-1",
        "out_dir": str(out_dir),
        "file_list": ["clip_001.mp4"],
        "params": {"model_type": "wan_2_2_5b", "seed": 99, "steps": 20},
    }
    emitted = emit_provenance_for_job(gen, str(out_dir), project_id="ws-1")
    assert len(emitted) == 1
    manifest = load_manifest(emitted[0])
    assert manifest.adapter_id == "wan_2_2_5b"
    assert manifest.seed == 99
    assert manifest.project_id == "ws-1"
    assert manifest.artifacts[0].sha256 == compute_sha256(
        out_dir / "clip_001.mp4"
    )


def test_emit_for_job_snapshot_no_outputs_no_manifests(tmp_path):
    from app.services.job_lifecycle import emit_provenance_for_job

    assert emit_provenance_for_job({"id": "x"}, str(tmp_path)) == []
