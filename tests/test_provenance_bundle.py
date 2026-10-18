"""A27 — bundle .tar.gz (export/import round-trip) e endpoints REST."""
from __future__ import annotations

import io
import tarfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.provenance import build_provenance_router
from app.services.provenance import (
    AssetRef,
    ValidationStatus,
    compute_sha256,
    emit_provenance,
    export_bundle,
    import_bundle,
    load_manifest,
    validate_manifest,
)
from tests.test_provenance import _make_manifest, _write


@pytest.fixture()
def project(tmp_path):
    manifest = _make_manifest(tmp_path)
    return tmp_path, manifest


def test_bundle_export_import_round_trip(project):
    root, manifest = project
    bundle = root / "shot_001_bundle.tar.gz"
    export_bundle(manifest, root, bundle)
    assert bundle.stat().st_size > 0

    dest = root / "other_machine"
    dest.mkdir(exist_ok=True)
    loaded, status, issues = import_bundle(bundle, dest)
    assert loaded.take_id == "take_001"
    assert status is ValidationStatus.VERIFIED
    assert issues == []


def test_bundle_import_detects_tampered_payload(project):
    root, manifest = project
    bundle = root / "shot_001_bundle.tar.gz"
    export_bundle(manifest, root, bundle)
    dest = root / "other_machine_tamper"
    dest.mkdir()
    loaded, status, issues = import_bundle(bundle, dest)
    assert status is ValidationStatus.VERIFIED

    # Adultera o artefato extraído e revalida.
    for extracted in dest.rglob("shot_001.mp4"):
        extracted.write_bytes(b"NEW BYTES " * 1024)
        break
    status, issues = validate_manifest(loaded, dest)
    assert status is ValidationStatus.CORRUPT
    assert any("adulterado" in issue for issue in issues)


def test_bundle_include_refs_adds_reference_files(project):
    root, manifest = project
    ref = root / "ref_img.png"
    _write(ref, b"REFDATA " * 64)
    manifest.references.append(
        AssetRef(
            asset_id="ref_1",
            role="reference_image",
            sha256=compute_sha256(ref),
            size_bytes=ref.stat().st_size,
            relative_path="ref_img.png",
        )
    )
    bundle = root / "with_refs.tar.gz"
    export_bundle(manifest, root, bundle, include_refs=True)
    with tarfile.open(bundle, "r:gz") as tar:
        names = tar.getnames()
    assert any("ref_img.png" in name for name in names)


def test_bundle_without_refs_excludes_references(project):
    root, manifest = project
    ref = root / "ref_img.png"
    _write(ref, b"REFDATA " * 64)
    manifest.references.append(
        AssetRef(
            asset_id="ref_1",
            role="reference_image",
            sha256=compute_sha256(ref),
            size_bytes=ref.stat().st_size,
            relative_path="ref_img.png",
        )
    )
    bundle = root / "no_refs.tar.gz"
    export_bundle(manifest, root, bundle, include_refs=False)
    with tarfile.open(bundle, "r:gz") as tar:
        names = tar.getnames()
    assert not any("ref_img.png" in name for name in names)


# ------------------------------------------------------------------
# Endpoints REST
# ------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path):
    manifest = _make_manifest(tmp_path)
    from app.services.provenance import write_manifest_atomic, manifest_path_for

    write_manifest_atomic(manifest, manifest_path_for(tmp_path / "take_001.mp4"))
    app = FastAPI()
    app.include_router(build_provenance_router(takes_root=lambda: str(tmp_path)))
    return TestClient(app), tmp_path


def test_get_provenance(client):
    http, _ = client
    resp = http.get("/api/v1/takes/take_001/provenance")
    assert resp.status_code == 200
    body = resp.json()
    assert body["take_id"] == "take_001"
    assert body["manifest"]["model"]["quantization"] == "int8"


def test_get_provenance_404_when_absent(client):
    http, _ = client
    resp = http.get("/api/v1/takes/ghost/provenance")
    assert resp.status_code == 404


def test_revalidate_returns_verified(client):
    http, _ = client
    resp = http.post("/api/v1/takes/take_001/provenance/revalidate")
    assert resp.status_code == 200
    assert resp.json()["status"] == "verified"


def test_revalidate_detects_tamper(client):
    http, root = client
    (root / "shot_001.mp4").write_bytes(b"TAMPERED " * 100)
    resp = http.post("/api/v1/takes/take_001/provenance/revalidate")
    assert resp.json()["status"] == "corrupt"


def test_bundle_download_and_upload_round_trip(client):
    http, root = client
    download = http.get("/api/v1/takes/take_001/provenance/bundle")
    assert download.status_code == 200
    bundle_bytes = download.content
    assert bundle_bytes[:2] == b"\x1f\x8b"  # gzip magic

    dest = root / "import_target"
    dest.mkdir()
    app = FastAPI()
    app.include_router(build_provenance_router(takes_root=lambda: str(dest)))
    with TestClient(app) as importer:
        resp = importer.post(
            "/api/v1/takes/take_001/provenance/bundle",
            files={"file": ("take_001.tar.gz", io.BytesIO(bundle_bytes))},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported_take_id"] == "take_001"
    assert body["status"] == "verified"


def test_bundle_upload_rejects_garbage(client):
    http, root = client
    dest = root / "import_target2"
    dest.mkdir()
    app = FastAPI()
    app.include_router(build_provenance_router(takes_root=lambda: str(dest)))
    with TestClient(app) as importer:
        resp = importer.post(
            "/api/v1/takes/take_001/provenance/bundle",
            files={"file": ("bad.tar.gz", io.BytesIO(b"not a tarball"))},
        )
    assert resp.status_code == 422


def test_retrofill_on_read_for_legacy_take(client):
    http, root = client
    # Take legado: só .meta.json + .mp4, sem manifesto.
    _write(root / "legacy" / "take_old.mp4", b"OLD " * 100)
    _write(
        root / "legacy" / "take_old.meta.json",
        b'{"tool":"studio","params":{"seed":5}}',
    )
    resp = http.get("/api/v1/takes/take_old/provenance")
    assert resp.status_code == 200
    manifest = resp.json()["manifest"]
    assert manifest["take_id"] == "take_old"
    assert manifest["seed"] == 5
