"""Testes de integração do ProvenanceManifest (A27)."""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from app.services.provenance import (
    AssetRef,
    HardwareProfile,
    LoRARef,
    ModelRef,
    ProvenanceManifest,
    ProvenanceValidationError,
    RuntimeRef,
    compute_sha256,
    manifest_from_dict,
    manifest_to_dict,
    validate_against_disk,
    write_manifest_atomic,
)


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _make_manifest(tmp: Path) -> ProvenanceManifest:
    artifact = tmp / "artifact.mp4"
    artifact.write_bytes(b"fake video content")
    sidecar = tmp / "sidecar.json"
    sidecar.write_text('{"params": 42}')
    return ProvenanceManifest(
        schema_version="1.0",
        take_id="take_001",
        project_id="proj_demo",
        generation_timestamp="2026-10-17T00:00:00Z",
        adapter_id="video_backend_a",
        adapter_revision="rev1",
        model=ModelRef(
            model_id="ltx25_distilled",
            sha256=_sha256_hex("model"),
            quantization="fp16",
            precision="full",
        ),
        seed=42,
        profile=HardwareProfile(gpu_name="RTX 3060", gpu_vram_mb=12288, system_ram_mb=32768, os="linux"),
        runtime=RuntimeRef(python="3.12", pytorch="2.7.1", cue_studio_revision="d99d394"),
        artifacts=[AssetRef(asset_id="art_1", role="output", sha256=compute_sha256(artifact), size_bytes=artifact.stat().st_size, relative_path="artifact.mp4")],
        sidecars={"sidecar.json": compute_sha256(sidecar)},
    )


def test_manifest_validates():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        m = _make_manifest(tmp)
        m.validate()  # não deve levantar


def test_manifest_rejects_bad_schema_version():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        m = _make_manifest(tmp)
        m.schema_version = "99.0"
        try:
            m.validate()
            assert False, "deveria ter levantado"
        except ProvenanceValidationError:
            pass


def test_manifest_rejects_bad_sha256():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        m = _make_manifest(tmp)
        m.artifacts[0].sha256 = "g" * 64
        try:
            m.validate()
            assert False, "deveria ter levantado"
        except ProvenanceValidationError:
            pass


def test_manifest_roundtrip():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        m = _make_manifest(tmp)
        d = manifest_to_dict(m)
        m2 = manifest_from_dict(d)
        assert m2.take_id == m.take_id
        assert m2.model.model_id == m.model.model_id
        assert m2.artifacts[0].sha256 == m.artifacts[0].sha256


def test_write_manifest_atomic():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        m = _make_manifest(tmp)
        path = tmp / "manifest.json"
        write_manifest_atomic(m, path)
        assert path.exists()
        loaded = manifest_from_dict(json.loads(path.read_text()))
        assert loaded.take_id == m.take_id


def test_validate_against_disk_verified():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        m = _make_manifest(tmp)
        status, issues = validate_against_disk(m, tmp)
        assert status == "verified"
        assert issues == []


def test_validate_against_disk_corrupt():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        m = _make_manifest(tmp)
        # Adulterar o artefato
        (tmp / "artifact.mp4").write_bytes(b"tampered content")
        status, issues = validate_against_disk(m, tmp)
        assert status == "corrupt"
        assert any("adulterado" in i for i in issues)


def test_validate_against_disk_incomplete():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        m = _make_manifest(tmp)
        (tmp / "artifact.mp4").unlink()
        status, issues = validate_against_disk(m, tmp)
        assert status == "incomplete"
        assert any("ausente" in i for i in issues)


def test_compute_sha256():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        f = tmp / "test.txt"
        f.write_text("hello")
        sha = compute_sha256(f)
        assert len(sha) == 64
        assert all(c in "0123456789abcdef" for c in sha)


def test_asset_ref_validate():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        f = tmp / "a.mp4"
        f.write_bytes(b"x")
        asset = AssetRef(asset_id="a1", role="output", sha256=compute_sha256(f), size_bytes=f.stat().st_size, relative_path="a.mp4")
        asset.validate()  # não deve levantar


def test_asset_ref_rejects_bad_role():
    asset = AssetRef(asset_id="a1", role="invalid_role", sha256="0" * 64, size_bytes=0, relative_path="a.mp4")
    try:
        asset.validate()
        assert False, "deveria ter levantado"
    except ProvenanceValidationError:
        pass


def test_lora_ref_validate():
    lora = LoRARef(lora_id="lora1", sha256="a" * 64, strength=0.8)
    lora.validate()


def test_lora_ref_rejects_strength_out_of_range():
    lora = LoRARef(lora_id="lora1", sha256="a" * 64, strength=3.0)
    try:
        lora.validate()
        assert False, "deveria ter levantado"
    except ProvenanceValidationError:
        pass


def test_model_ref_validate():
    model = ModelRef(model_id="m1", sha256="b" * 64, quantization="fp16", precision="full")
    model.validate()


def test_hardware_profile_validate():
    profile = HardwareProfile(gpu_name="RTX 3060", gpu_vram_mb=12288, system_ram_mb=32768, os="linux")
    profile.validate()


def test_hardware_profile_rejects_negative_vram():
    profile = HardwareProfile(gpu_name="RTX 3060", gpu_vram_mb=-1, system_ram_mb=32768, os="linux")
    try:
        profile.validate()
        assert False, "deveria ter levantado"
    except ProvenanceValidationError:
        pass
