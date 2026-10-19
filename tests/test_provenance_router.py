"""Live router contracts: nested manifests, portable bundles and legacy review."""
import io
from pathlib import Path
import tarfile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.routers.provenance import build_provenance_router
from app.services.provenance import (
    ProvenanceValidationError, import_bundle, manifest_path_for, retrofill_manifest,
    load_manifest, validate_against_disk,
)
from tests.test_provenance import _make_manifest


def test_nested_take_can_be_read_revalidated_exported_and_imported(tmp_path):
    from app.services.provenance import write_manifest_atomic
    take = tmp_path / 'workspace' / 'take'
    take.mkdir(parents=True)
    manifest = _make_manifest(take)
    write_manifest_atomic(manifest, take / 'artifact.provenance.json')
    app = FastAPI()
    app.include_router(build_provenance_router(str(tmp_path)))
    with TestClient(app) as client:
        base = '/api/v1/takes/take_001/provenance'
        assert client.get(base).status_code == 200
        assert client.post(base + '/revalidate').json()['status'] == 'verified'
        bundle = client.get(base + '/bundle')
        assert bundle.status_code == 200
        imported = client.post(base + '/bundle', files={'file': ('bundle.tar.gz', bundle.content, 'application/gzip')})
        assert imported.status_code == 200, imported.text
        assert imported.json()['status'] == 'verified'
    imports = list((tmp_path / '_imports').glob('*/manifest.provenance.json'))
    assert len(imports) == 1
    copied = load_manifest(imports[0])
    assert validate_against_disk(copied, tmp_path) == ('verified', [])


def test_legacy_metadata_never_claims_full_provenance(tmp_path):
    artifact = tmp_path / 'old.mp4'
    artifact.write_bytes(b'legacy output')
    artifact.with_suffix('.meta.json').write_text('{"params":{"seed":42}}')
    manifest = retrofill_manifest(artifact, project_dir=tmp_path, take_id='old')
    assert manifest_path_for(artifact).exists()
    status, _ = validate_against_disk(manifest, tmp_path)
    assert status == 'needs_review'


def test_archive_traversal_is_rejected_before_publication(tmp_path):
    bundle = tmp_path / 'hostile.tar.gz'
    with tarfile.open(bundle, 'w:gz') as tar:
        member = tarfile.TarInfo('../escaped.txt')
        member.size = 4
        tar.addfile(member, io.BytesIO(b'evil'))
    with pytest.raises(ProvenanceValidationError):
        import_bundle(bundle, tmp_path / 'project')
    assert not (tmp_path / 'escaped.txt').exists()
    assert not list((tmp_path / 'project').glob('.provenance-import-*'))


def test_job_completion_emits_real_artifact_hash_without_fabricated_model_lineage(tmp_path):
    from app.services.job_lifecycle import emit_provenance_for_job
    artifact = tmp_path / 'generated.mp4'
    artifact.write_bytes(b'generated content')
    job = {'id': 'job-123', 'file_list': [str(artifact)],
           'params': {'model_type': 'installed-model', 'seed': 42, 'api_key': 'not-exported'}}
    emitted = emit_provenance_for_job(job, str(tmp_path))
    assert len(emitted) == 1
    manifest = load_manifest(Path(emitted[0]))
    assert manifest.seed == 42
    assert 'api_key' not in manifest.parameters
    assert validate_against_disk(manifest, tmp_path)[0] == 'needs_review'
    artifact.write_bytes(b'tampered')
    assert validate_against_disk(manifest, tmp_path)[0] == 'corrupt'
