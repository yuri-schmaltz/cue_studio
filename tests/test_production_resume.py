"""Tests for the ProductionResume facade."""

from __future__ import annotations

import json

import pytest

from app.services.production_resume import ProductionResume, ResumeResult
from app.services.production_store import ProductionStore


def _snapshot(pipeline_id: str = "pipe-1", **overrides):
    base = {
        "pipeline_id": pipeline_id,
        "pipeline_type": "music_video",
        "status": "failed",
        "workspace": "ws-1",
        "created_at": "2026-09-28T10:00:00+00:00",
        "updated_at": "2026-09-28T10:05:00+00:00",
        "clip_count": 6,
        "stages": [
            {"name": "plan", "status": "completed"},
            {"name": "image", "status": "failed", "error": "OOM"},
        ],
        "output_files": [],
        "attempt": 1,
    }
    base.update(overrides)
    return base


@pytest.fixture
def store(tmp_path):
    return ProductionStore(tmp_path / "productions.sqlite3")


def _make(store, pipeline_resume=None) -> ProductionResume:
    return ProductionResume(store=store, pipeline_resume=pipeline_resume)


def _runs_for_pipeline(store: ProductionStore, pipeline_id: str) -> list[dict]:
    with store.connect() as conn:
        rows = conn.execute(
            "SELECT payload FROM runs WHERE json_extract(correlations, '$.pipeline_id') = ?",
            (pipeline_id,),
        ).fetchall()
    return [json.loads(r["payload"]) for r in rows]


# ----------------------------------------------------------- helpers


def test_resume_result_serializable() -> None:
    r = ResumeResult(ok=True, message="ok", run_id="r1", production_id="p1", attempt=2)
    assert r.to_dict() == {
        "ok": True,
        "message": "ok",
        "run_id": "r1",
        "production_id": "p1",
        "attempt": 2,
    }


def test_resume_result_defaults() -> None:
    r = ResumeResult(ok=False, message="nope")
    assert r.run_id is None
    assert r.production_id is None
    assert r.attempt is None


# ----------------------------------------------------------- pipeline state


def test_get_pipeline_state_returns_latest_attempt(store: ProductionStore) -> None:
    facade = _make(store)
    store.upsert_pipeline(_snapshot(attempt=1))
    store.upsert_pipeline(_snapshot(attempt=2, status="completed"))
    state = facade.get_pipeline_state("pipe-1")
    assert state is not None
    assert state["attempt"] == 2
    assert state["status"] == "completed"


def test_get_pipeline_state_returns_none_for_unknown(store: ProductionStore) -> None:
    facade = _make(store)
    assert facade.get_pipeline_state("nonexistent") is None


# ----------------------------------------------------------- resume


def test_resume_returns_failure_when_pipeline_resume_says_no(store: ProductionStore) -> None:
    facade = _make(store, pipeline_resume=lambda pid, od: (False, "already running"))
    store.upsert_pipeline(_snapshot())
    result = facade.resume_production(pipeline_id="pipe-1", out_dir="ws-1")
    assert result.ok is False
    assert result.message == "already running"


def test_resume_creates_new_attempt_on_success(store: ProductionStore) -> None:
    """The returned attempt is previous+1; the resume event records it."""
    facade = _make(store, pipeline_resume=lambda pid, od: (True, "Resumed successfully"))
    store.upsert_pipeline(_snapshot())
    result = facade.resume_production(pipeline_id="pipe-1", out_dir="ws-1")
    assert result.ok is True
    assert result.attempt == 2
    # The resume event was emitted with attempt=2
    events = [e for e in store.list_events() if e["kind"] == "resume"]
    assert len(events) == 1
    assert events[0]["payload"]["attempt"] == 2
    assert events[0]["payload"]["pipeline_id"] == "pipe-1"


def test_resume_records_event(store: ProductionStore) -> None:
    facade = _make(store, pipeline_resume=lambda pid, od: (True, "ok"))
    store.upsert_pipeline(_snapshot())
    facade.resume_production(pipeline_id="pipe-1", out_dir="ws-1")
    events = store.list_events()
    kinds = [e["kind"] for e in events]
    assert "upsert" in kinds
    assert "resume" in kinds


def test_resume_first_attempt_is_one_when_no_history(store: ProductionStore) -> None:
    facade = _make(store, pipeline_resume=lambda pid, od: (True, "ok"))
    result = facade.resume_production(pipeline_id="brand-new", out_dir="ws-1")
    assert result.ok is True
    assert result.attempt == 1


def test_resume_handles_pipeline_resume_exception(store: ProductionStore) -> None:
    def boom(pid, od):
        raise RuntimeError("kapow")

    facade = _make(store, pipeline_resume=boom)
    result = facade.resume_production(pipeline_id="pipe-x", out_dir="ws-1")
    assert result.ok is False
    assert "kapow" in result.message


# ----------------------------------------------------------- retake


def test_retake_stage_requires_name(store: ProductionStore) -> None:
    facade = _make(store)
    result = facade.retake_stage(pipeline_id="pipe-1", out_dir="ws-1", stage_name="")
    assert result.ok is False


def test_retake_stage_returns_failure_for_unknown_pipeline(store: ProductionStore) -> None:
    facade = _make(store)
    result = facade.retake_stage(pipeline_id="nope", out_dir="ws-1", stage_name="image")
    assert result.ok is False
    assert "No saved state" in result.message


def test_retake_stage_records_event(store: ProductionStore) -> None:
    facade = _make(store)
    store.upsert_pipeline(_snapshot())
    result = facade.retake_stage(pipeline_id="pipe-1", out_dir="ws-1", stage_name="image")
    assert result.ok is True
    assert "image" in result.message
    events = store.list_events()
    retake = [e for e in events if e["kind"] == "retake"]
    assert len(retake) == 1
    assert retake[0]["payload"]["stage"] == "image"


# ----------------------------------------------------------- failures list


def test_list_failures_includes_failed_and_cancelled(store: ProductionStore) -> None:
    facade = _make(store)
    store.upsert_pipeline(_snapshot(pipeline_id="p1", status="failed"))
    store.upsert_pipeline(_snapshot(pipeline_id="p2", status="cancelled"))
    store.upsert_pipeline(_snapshot(pipeline_id="p3", status="completed"))
    failures = facade.list_failures()
    assert len(failures) == 2
    statuses = {r["status"] for r in failures}
    assert statuses == {"failed", "cancelled"}
