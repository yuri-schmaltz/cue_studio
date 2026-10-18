"""A19 — post-restart job classification and idempotent resume.

Covers the acceptance criteria from
``_reversa_forward/plano-2026-10-04/25-feature-a19-resume.md``:

* restart with complete media → ``done`` (no resume offered);
* restart with partial media → ``interrupted`` (resume offered);
* restart with a recorded error → ``failed``;
* resume never re-executes a ``done`` job and is idempotent for repeat
  calls (``Idempotency-Key``).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from app.services.job_classifier import (  # noqa: E402
    DONE,
    FAILED,
    INTERRUPTED,
    UNKNOWN,
    QueueResumeService,
    classify,
    classify_all,
)
from app.services.production_store import ProductionStore  # noqa: E402


def _snapshot(pipeline_id: str = "pipe-1", **overrides):
    base = {
        "pipeline_id": pipeline_id,
        "pipeline_type": "music_video",
        "status": "running",
        "workspace": "ws-1",
        "created_at": "2026-09-28T10:00:00+00:00",
        "updated_at": "2026-09-28T10:05:00+00:00",
        "clip_count": 2,
        "stages": [],
        "output_files": [],
        "attempt": 1,
    }
    base.update(overrides)
    return base


@pytest.fixture
def store(tmp_path: Path) -> ProductionStore:
    return ProductionStore(tmp_path / "productions.sqlite3")


@pytest.fixture
def media_root(tmp_path: Path) -> Path:
    root = tmp_path / "outputs"
    (root / "ws-1").mkdir(parents=True)
    return root


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    return path


# ------------------------------------------------------------- classify


def test_classify_running_without_media_is_interrupted(store, media_root):
    store.upsert_pipeline(_snapshot("pipe-run", status="running"))
    state = classify("pipe-run", store, media_root / "ws-1")
    assert state.status == INTERRUPTED
    assert state.can_resume is True
    assert state.media_path is None


def test_classify_completed_with_full_media_is_done(store, media_root):
    store.upsert_pipeline(
        _snapshot(
            "pipe-done",
            status="completed",
            output_files=["pipe-done_clip0.mp4", "pipe-done_clip1.mp4"],
        )
    )
    _touch(media_root / "ws-1" / "pipe-done_clip0.mp4")
    _touch(media_root / "ws-1" / "pipe-done_clip1.mp4")
    state = classify("pipe-done", store, media_root / "ws-1")
    assert state.status == DONE
    assert state.can_resume is False
    assert state.media_path == media_root / "ws-1"


def test_classify_completed_with_partial_media_is_interrupted(store, media_root):
    store.upsert_pipeline(
        _snapshot(
            "pipe-partial",
            status="completed",
            output_files=["pipe-partial_clip0.mp4", "pipe-partial_clip1.mp4"],
        )
    )
    _touch(media_root / "ws-1" / "pipe-partial_clip0.mp4")
    state = classify("pipe-partial", store, media_root / "ws-1")
    assert state.status == INTERRUPTED
    assert state.can_resume is True


def test_classify_error_recorded_is_failed(store, media_root):
    store.upsert_pipeline(_snapshot("pipe-err", status="failed", error="OOM"))
    state = classify("pipe-err", store, media_root / "ws-1")
    assert state.status == FAILED
    assert state.can_resume is True


def test_classify_unknown_job(store, media_root):
    state = classify("no-such-job", store, media_root)
    assert state.status == UNKNOWN
    assert state.can_resume is False
    assert state.media_path is None


def test_classify_media_without_db_record_is_done(store, media_root):
    _touch(media_root / "ws-1" / "ghost-job_clip0.mp4")
    state = classify("ghost-job", store, media_root / "ws-1")
    assert state.status == DONE
    assert state.can_resume is False


def test_classify_resolves_production_and_pipeline_ids(store, media_root):
    store.upsert_pipeline(_snapshot("pipe-bridge", status="failed", error="x"))
    run = store.find_run("pipe-bridge")
    assert run is not None
    for lookup in (run["id"], run["production_id"], "pipe-bridge"):
        assert classify(lookup, store, media_root / "ws-1").status == FAILED


def test_classify_all_latest_attempt_per_production(store, media_root):
    store.upsert_pipeline(_snapshot("pipe-a", status="running"))
    store.upsert_pipeline(_snapshot("pipe-a", status="failed", attempt=2, error="boom"))
    store.upsert_pipeline(_snapshot("pipe-b", status="running"))
    states = {s.id: s.status for s in classify_all(store, media_root)}
    assert len(states) == 2
    assert set(states.values()) == {INTERRUPTED, FAILED}


# --------------------------------------------------- interrupted_at (A19)


def test_mark_all_interrupted_stamps_only_active_runs(store):
    store.upsert_pipeline(_snapshot("pipe-i1", status="running"))
    store.upsert_pipeline(_snapshot("pipe-i2", status="completed"))
    stamped = store.mark_all_interrupted(when=1234.0)
    assert stamped == 1
    run = store.find_run("pipe-i1")
    # interrupted_at é coluna TEXT; 1234.0 grava como '1234.0'.
    assert str(run["interrupted_at"]) == "1234.0"
    assert store.find_run("pipe-i2")["interrupted_at"] is None
    # Idempotent: a second boot scan changes nothing.
    assert store.mark_all_interrupted(when=9999.0) == 0
    assert str(store.find_run("pipe-i1")["interrupted_at"]) == "1234.0"


def test_mark_run_interrupted_never_overwrites(store):
    store.upsert_pipeline(_snapshot("pipe-i3", status="running"))
    assert store.mark_run_interrupted(store.find_run("pipe-i3")["id"], when=100.0)
    assert not store.mark_run_interrupted(store.find_run("pipe-i3")["id"], when=200.0)
    # interrupted_at é coluna TEXT; 100.0 grava como '100.0'.
    assert str(store.find_run("pipe-i3")["interrupted_at"]) == "100.0"


def test_interrupted_at_column_exists_on_fresh_db(store):
    with store.connect() as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(runs)")}
    assert "interrupted_at" in columns


# ------------------------------------------------------- resume service


def test_resume_service_skips_done_jobs(store, media_root):
    calls = []

    def fake_resume(pid, out_dir):
        calls.append((pid, out_dir))
        return (True, "resumed")

    store.upsert_pipeline(
        _snapshot("pipe-r1", status="completed", output_files=["pipe-r1_clip0.mp4"])
    )
    _touch(media_root / "ws-1" / "pipe-r1_clip0.mp4")
    service = QueueResumeService(store, fs_root=media_root, resume=fake_resume)
    result = service.resume_job("pipe-r1")
    assert result["ok"] is True
    assert result["skipped"] is True
    assert result["status"] == DONE
    assert calls == []  # finished output is never re-executed


def test_resume_service_dispatches_for_interrupted(store, media_root):
    calls = []

    def fake_resume(pid, out_dir):
        calls.append((pid, out_dir))
        return (True, "resumed from checkpoint")

    store.upsert_pipeline(_snapshot("pipe-r2", status="running"))
    service = QueueResumeService(store, fs_root=media_root, resume=fake_resume)
    result = service.resume_job("pipe-r2", out_dir="ws-1")
    assert result["ok"] is True
    assert result["skipped"] is False
    assert result["message"] == "resumed from checkpoint"
    assert calls == [("pipe-r2", "ws-1")]
    events = [e for e in store.list_events() if e["kind"] == "queue.resume"]
    assert len(events) == 1
    assert events[0]["payload"]["idempotency_key"] == result["idempotency_key"]


def test_resume_is_idempotent_for_repeated_calls(store, media_root):
    calls = []

    def fake_resume(pid, out_dir):
        calls.append(pid)
        return {"ok": True, "message": "resumed", "attempt": 2}

    store.upsert_pipeline(_snapshot("pipe-r3", status="running"))
    service = QueueResumeService(store, fs_root=media_root, resume=fake_resume)
    first = service.resume_job("pipe-r3")
    second = service.resume_job("pipe-r3")
    assert calls == ["pipe-r3"]  # dispatch happened once — no duplicate media
    assert first["replayed"] is False
    assert second["replayed"] is True
    assert second["ok"] is True
    assert second["attempt"] == 2


def test_resume_explicit_idempotency_key_is_honored(store, media_root):
    calls = []

    def fake_resume(pid, out_dir):
        calls.append(pid)
        return (True, "resumed")

    store.upsert_pipeline(_snapshot("pipe-r4", status="failed", error="OOM"))
    service = QueueResumeService(store, fs_root=media_root, resume=fake_resume)
    service.resume_job("pipe-r4", idempotency_key="op-123")
    replay = service.resume_job("pipe-r4", idempotency_key="op-123")
    assert calls == ["pipe-r4"]
    assert replay["replayed"] is True
    # A different key dispatches again (a deliberate user retry).
    service.resume_job("pipe-r4", idempotency_key="op-456")
    assert calls == ["pipe-r4", "pipe-r4"]


def test_resume_unknown_job_is_not_ok(store, media_root):
    service = QueueResumeService(store, fs_root=media_root, resume=lambda *a: (True, "x"))
    result = service.resume_job("ghost")
    assert result["ok"] is False
    assert result["status"] == UNKNOWN


# ----------------------------------------------------------- HTTP layer


@pytest.fixture
def client_app(store, media_root):
    from app.routers.queue import build_queue_router

    def fake_resume(pid, out_dir):
        return (True, f"resumed {pid}")

    app = FastAPI()
    app.include_router(
        build_queue_router(store=store, fs_root=media_root, resume=fake_resume)
    )
    return app


@pytest.fixture
def client(client_app):
    return TestClient(client_app)


def test_queue_list_returns_classified_jobs(client, store, media_root):
    store.upsert_pipeline(_snapshot("q-done", status="completed", output_files=["q-done_a.mp4"]))
    _touch(media_root / "ws-1" / "q-done_a.mp4")
    store.upsert_pipeline(_snapshot("q-run", status="running"))
    response = client.get("/api/v1/queue")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    statuses = {job["status"] for job in body["jobs"]}
    assert statuses == {DONE, INTERRUPTED}
    done_job = next(j for j in body["jobs"] if j["status"] == DONE)
    assert done_job["can_resume"] is False
    assert done_job["title"] is not None
    interrupted_job = next(j for j in body["jobs"] if j["status"] == INTERRUPTED)
    assert interrupted_job["can_resume"] is True


def test_queue_resume_endpoint_dispatches(client, store, media_root):
    store.upsert_pipeline(_snapshot("q-res", status="running"))
    response = client.post("/api/v1/queue/q-res/resume", json={"out_dir": "ws-1"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["message"] == "resumed q-res"


def test_queue_resume_endpoint_unknown_is_404(client):
    response = client.post("/api/v1/queue/nope/resume")
    assert response.status_code == 404


def test_queue_resume_endpoint_idempotent_via_header(client, media_root):
    store = ProductionStore(media_root.parent / "productions.sqlite3")
    from app.routers.queue import build_queue_router

    calls = []

    def counting_resume(pid, out_dir):
        calls.append(pid)
        return (True, "resumed")

    app = FastAPI()
    app.include_router(
        build_queue_router(store=store, fs_root=media_root, resume=counting_resume)
    )
    local_client = TestClient(app)
    store.upsert_pipeline(_snapshot("q-idem", status="running"))
    first = local_client.post(
        "/api/v1/queue/q-idem/resume", headers={"Idempotency-Key": "op-7"}
    )
    second = local_client.post(
        "/api/v1/queue/q-idem/resume", headers={"Idempotency-Key": "op-7"}
    )
    assert calls == ["q-idem"]
    assert first.json()["replayed"] is False
    assert second.json()["replayed"] is True


def test_building_router_marks_previous_boot_interruptions(store, media_root):
    from app.routers.queue import build_queue_router

    store.upsert_pipeline(_snapshot("q-boot", status="running"))
    assert store.find_run("q-boot")["interrupted_at"] is None
    build_queue_router(store=store, fs_root=media_root)
    assert store.find_run("q-boot")["interrupted_at"] is not None
