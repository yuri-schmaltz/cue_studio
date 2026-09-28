"""Tests for the SQLite-backed ProductionStore."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

import pytest

from app.services.production_store import ProductionStore


@pytest.fixture
def store(tmp_path: Path) -> ProductionStore:
    return ProductionStore(tmp_path / "productions.sqlite3")


def _snapshot(**overrides):
    base = {
        "pipeline_id": "pipe-abc",
        "pipeline_type": "music_video",
        "status": "running",
        "workspace": "ws-1",
        "created_at": "2026-09-28T10:00:00+00:00",
        "updated_at": "2026-09-28T10:05:00+00:00",
        "clip_count": 6,
        "stages": [{"name": "plan", "status": "completed"}],
        "output_files": ["/a.mp4"],
    }
    base.update(overrides)
    return base


# ------------------------------------------------------------- basics


def test_persists_production_and_run(store: ProductionStore) -> None:
    out = store.upsert_pipeline(_snapshot())
    prod_id = out["production"]["id"]
    run_id = out["run"]["id"]

    assert store.get_production(prod_id)["id"] == prod_id
    assert store.get_run(run_id)["id"] == run_id
    assert store.get_run(run_id)["production_id"] == prod_id


def test_upsert_is_idempotent(store: ProductionStore) -> None:
    """Same pipeline id → upsert updates rather than duplicating."""
    store.upsert_pipeline(_snapshot())
    store.upsert_pipeline(_snapshot(status="completed"))
    assert len(store.list_productions()) == 1


def test_production_starts_new_run_on_attempt_bump(store: ProductionStore) -> None:
    """Different attempt on the same pipeline id creates a distinct run row."""
    out1 = store.upsert_pipeline(_snapshot(attempt=1))
    prod_id = out1["production"]["id"]
    out2 = store.upsert_pipeline(_snapshot(attempt=2, status="completed"))
    # Same production
    assert out2["production"]["id"] == prod_id
    # Different runs
    assert out1["run"]["id"] != out2["run"]["id"]
    runs = store.list_runs(prod_id)
    assert len(runs) == 2
    assert {r["attempt"] for r in runs} == {1, 2}


def test_workspace_ids_stored_as_json(store: ProductionStore) -> None:
    store.upsert_pipeline(_snapshot(workspace="custom"))
    prod = store.list_productions()[0]
    assert "custom" in prod["workspace_ids"]


def test_stages_roundtrip(store: ProductionStore) -> None:
    stages = [
        {"name": "plan", "status": "completed"},
        {"name": "image", "status": "failed", "error": "OOM"},
    ]
    store.upsert_pipeline(_snapshot(stages=stages))
    run_id = store.list_productions()[0]["run_ids"][0]
    assert store.get_run(run_id)["stages"] == stages


# ----------------------------------------------------------------- events


def test_upsert_appends_event(store: ProductionStore) -> None:
    store.upsert_pipeline(_snapshot())
    events = store.list_events()
    assert len(events) == 1
    assert events[0]["kind"] == "upsert"


def test_event_payload_is_dict(store: ProductionStore) -> None:
    store.upsert_pipeline(_snapshot(status="completed"))
    event = store.list_events()[0]
    assert event["payload"]["status"] == "completed"


def test_append_event_returns_id(store: ProductionStore) -> None:
    eid = store.append_event(kind="manual", payload={"k": "v"})
    assert isinstance(eid, int) and eid > 0


def test_list_events_filters_by_run(store: ProductionStore) -> None:
    out = store.upsert_pipeline(_snapshot())
    run_id = out["run"]["id"]
    store.append_event(run_id=run_id, kind="retry")
    store.append_event(kind="other")  # unattached
    only_run = store.list_events(run_id=run_id)
    assert all(e["run_id"] == run_id for e in only_run)
    assert any(e["kind"] == "retry" for e in only_run)


# ----------------------------------------------------------------- filters


def test_list_productions_filters_by_status(store: ProductionStore) -> None:
    store.upsert_pipeline(_snapshot(pipeline_id="a", status="running"))
    store.upsert_pipeline(_snapshot(pipeline_id="b", status="completed"))
    store.upsert_pipeline(_snapshot(pipeline_id="c", status="completed"))

    completed = store.list_productions(status="completed")
    assert len(completed) == 2
    assert all(p["run_ids"] for p in completed)


def test_list_productions_limit_clamped(store: ProductionStore) -> None:
    for i in range(5):
        store.upsert_pipeline(_snapshot(pipeline_id=f"p-{i}"))
    assert len(store.list_productions(limit=3)) == 3
    assert len(store.list_productions(limit=9999)) == 5


def test_list_runs_orders_by_attempt_desc(store: ProductionStore) -> None:
    out = store.upsert_pipeline(_snapshot(pipeline_id="p", attempt=1))
    prod_id = out["production"]["id"]
    store.upsert_pipeline(_snapshot(pipeline_id="p", attempt=3))
    store.upsert_pipeline(_snapshot(pipeline_id="p", attempt=2))
    runs = store.list_runs(prod_id)
    assert [r["attempt"] for r in runs] == [3, 2, 1]


# ----------------------------------------------------------------- delete


def test_delete_production_cascades_to_runs(store: ProductionStore) -> None:
    out = store.upsert_pipeline(_snapshot())
    prod_id = out["production"]["id"]
    run_id = out["run"]["id"]
    assert store.delete_production(prod_id) is True
    assert store.get_production(prod_id) is None
    assert store.get_run(run_id) is None


def test_delete_nonexistent_returns_false(store: ProductionStore) -> None:
    assert store.delete_production("nope") is False


# ----------------------------------------------------------------- catalog


def test_catalog_returns_full_state(store: ProductionStore) -> None:
    store.upsert_pipeline(_snapshot(pipeline_id="p1"))
    store.upsert_pipeline(_snapshot(pipeline_id="p2"))
    cat = store.catalog()
    assert len(cat["productions"]) == 2
    assert len(cat["runs"]) == 2
    assert cat["workspace_id"] == "default"


def test_sync_from_pipelines_skips_malformed(store: ProductionStore) -> None:
    """sync_from_pipelines is the lenient path — bad rows are logged, not raised."""
    count = store.sync_from_pipelines(
        [_snapshot(pipeline_id="good"), {"no_id": True}]
    )
    assert count == 1
    assert len(store.list_productions()) == 1


# ----------------------------------------------------------------- thread safety


def test_concurrent_upserts_dont_corrupt(store: ProductionStore) -> None:
    """Multiple threads upserting the same pipeline must not lose data."""
    barrier = threading.Barrier(8)

    def worker(i):
        barrier.wait()
        store.upsert_pipeline(_snapshot(status=f"status-{i}"))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Exactly one production, exactly one run row (idempotent upsert).
    assert len(store.list_productions()) == 1
    runs = store.list_runs(store.list_productions()[0]["id"])
    assert len(runs) == 1
    # 8 events were recorded.
    assert len(store.list_events()) == 8


# ----------------------------------------------------------------- persistence


def test_store_survives_restart(tmp_path: Path) -> None:
    """A new ProductionStore on the same path must read the prior data."""
    path = tmp_path / "persist.sqlite3"
    s1 = ProductionStore(path)
    s1.upsert_pipeline(_snapshot(pipeline_id="p1"))

    s2 = ProductionStore(path)
    assert len(s2.list_productions()) == 1


def test_pragma_foreign_keys_is_on(store: ProductionStore) -> None:
    with store.connect() as conn:
        result = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    assert int(result) == 1


def test_corrupt_pipeline_payload_raises(store: ProductionStore) -> None:
    with pytest.raises(ValueError):
        store.upsert_pipeline({})
