"""Ownership, error and receipt contracts for real-model generation."""
import json
import pytest
from app.services.reference_generation import ReferenceGenerationClient


def client(tmp_path, monkeypatch, status):
    c = ReferenceGenerationClient('http://127.0.0.1:7860', tmp_path, tmp_path / 'receipts', poll_interval=0)
    responses = iter([{"job_id": "job-real", "status": "queued"}, status])
    monkeypatch.setattr(c, 'request', lambda *a: next(responses))
    return c


def test_failed_inference_never_becomes_synthetic_success(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch, {"status": "failed", "error": "CUDA OOM"})
    with pytest.raises(RuntimeError, match='CUDA OOM'):
        c.generate('S01', {"model_type": "video", "prompt": "workshop"}, {'.mp4'})
    receipt = json.loads((tmp_path / 'receipts/S01.json').read_text())
    assert receipt['job_id'] == 'job-real'
    assert receipt['status'] == 'failed'
    assert 'artifact' not in receipt


def test_only_owned_completed_artifact_is_accepted(tmp_path, monkeypatch):
    (tmp_path / 'video.mp4').write_bytes(b'generated output')
    c = client(tmp_path, monkeypatch, {"status": "completed", "output_files": ['video.mp4']})
    assert c.generate('S01', {"model_type": "video", "prompt": "workshop"}, {'.mp4'}) == tmp_path / 'video.mp4'
    receipt = json.loads((tmp_path / 'receipts/S01.json').read_text())
    import hashlib
    assert receipt['sha256'] == hashlib.sha256(b'generated output').hexdigest()


@pytest.mark.parametrize('files', [[], ['missing.mp4'], ['../escape.mp4']])
def test_invalid_completed_output_is_rejected(tmp_path, monkeypatch, files):
    c = client(tmp_path, monkeypatch, {"status": "completed", "output_files": files})
    with pytest.raises((ValueError, RuntimeError)):
        c.generate('S01', {"model_type": "video", "prompt": "workshop"}, {'.mp4'})


def test_polling_timeout_preserves_job_id(tmp_path):
    c = ReferenceGenerationClient('http://localhost:7860', tmp_path, tmp_path / 'receipts', timeout=0)
    c.request = lambda *a: {"job_id": "in-flight", "status": "queued"}
    with pytest.raises(TimeoutError):
        c.generate('S01', {"model_type": "video", "prompt": "workshop"}, {'.mp4'})
    assert json.loads((tmp_path / 'receipts/S01.json').read_text())['job_id'] == 'in-flight'


def test_completed_receipt_replays_without_duplicate_generation(tmp_path, monkeypatch):
    artifact = tmp_path / 'video.mp4'
    artifact.write_bytes(b'generated')
    c = client(tmp_path, monkeypatch, {"status": "completed", "output_files": ['video.mp4']})
    params = {"model_type": "video", "prompt": "workshop"}
    c.generate('S01', params, {'.mp4'})
    monkeypatch.setattr(c, 'request', lambda *a: pytest.fail('duplicate generation or polling'))
    assert c.generate('S01', params, {'.mp4'}) == artifact
    with pytest.raises(ValueError, match='parameters changed'):
        c.generate('S01', {**params, 'prompt': 'changed'}, {'.mp4'})
    artifact.write_bytes(b'tampered')
    with pytest.raises(ValueError, match='missing or changed'):
        c.generate('S01', params, {'.mp4'})


def test_transient_status_timeout_keeps_existing_job(tmp_path, monkeypatch):
    artifact = tmp_path / 'video.mp4'
    artifact.write_bytes(b'generated')
    c = ReferenceGenerationClient('http://localhost:7860', tmp_path, tmp_path / 'receipts', poll_interval=0)
    replies = iter([{"job_id": "same-job", "status": "queued"}, TimeoutError('model loading'),
                    {"status": "completed", "output_files": ['video.mp4']}])
    calls = []
    def request(path, body=None):
        calls.append((path, body))
        reply = next(replies)
        if isinstance(reply, Exception):
            raise reply
        return reply
    monkeypatch.setattr(c, 'request', request)
    assert c.generate('S01', {"model_type": "video", "prompt": "workshop"}, {'.mp4'}) == artifact
    assert sum(body is not None for _, body in calls) == 1
    assert [path for path, body in calls if body is None] == ['/api/v1/status/same-job'] * 2
