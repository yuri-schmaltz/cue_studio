"""Tests for the /api/v1/productions FastAPI router."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.testclient import TestClient


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
def store(tmp_path: Path):
    from app.services.production_store import ProductionStore

    return ProductionStore(tmp_path / "productions.sqlite3")


@pytest.fixture
def app(store):
    """FastAPI app with a productions router that uses our temp store."""
    from app.routers.productions import build_productions_router

    app = FastAPI()
    app.include_router(build_productions_router(store=store))
    return app


async def _read_body(request: Request) -> dict:
    try:
        raw = await request.body()
    except Exception:
        return {}
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


@pytest.fixture
def client(app):
    return TestClient(app)


# ---------------------------------------------------------------- list


def test_list_empty_returns_zero(client):
    r = client.get("/api/v1/productions")
    assert r.status_code == 200
    assert r.json() == {"count": 0, "productions": []}


def test_list_returns_persisted_productions(client, store):
    store.upsert_pipeline(_snapshot(pipeline_id="p1"))
    store.upsert_pipeline(_snapshot(pipeline_id="p2", status="completed"))
    r = client.get("/api/v1/productions")
    assert r.status_code == 200
    assert r.json()["count"] == 2


def test_list_filter_by_status(client, store):
    store.upsert_pipeline(_snapshot(pipeline_id="p1", status="failed"))
    store.upsert_pipeline(_snapshot(pipeline_id="p2", status="completed"))
    r = client.get("/api/v1/productions?status=completed")
    assert r.status_code == 200
    assert r.json()["count"] == 1


def test_list_limit_param(client, store):
    for i in range(5):
        store.upsert_pipeline(_snapshot(pipeline_id=f"p-{i}"))
    r = client.get("/api/v1/productions?limit=2")
    assert r.json()["count"] == 2


# ---------------------------------------------------------------- get


def test_get_production_404(client):
    r = client.get("/api/v1/productions/nope")
    assert r.status_code == 404


def test_get_production_returns_runs(client, store):
    store.upsert_pipeline(_snapshot(pipeline_id="p1", attempt=1))
    store.upsert_pipeline(_snapshot(pipeline_id="p1", attempt=2))
    body = client.get("/api/v1/productions").json()
    prod_id = body["productions"][0]["id"]
    r = client.get(f"/api/v1/productions/{prod_id}")
    assert r.status_code == 200
    payload = r.json()
    assert payload["production"]["id"] == prod_id
    assert len(payload["runs"]) == 2


# ---------------------------------------------------------------- runs


def test_list_runs(client, store):
    store.upsert_pipeline(_snapshot(pipeline_id="p1", attempt=1))
    out = store.upsert_pipeline(_snapshot(pipeline_id="p1", attempt=2))
    r = client.get(f"/api/v1/productions/{out['production']['id']}/runs")
    assert r.status_code == 200
    assert r.json()["count"] == 2


# ---------------------------------------------------------------- events


def test_list_events(client, store):
    out = store.upsert_pipeline(_snapshot())
    r = client.get(f"/api/v1/productions/{out['production']['id']}/events")
    assert r.status_code == 200
    events = r.json()["events"]
    assert any(e["kind"] == "upsert" for e in events)


# ---------------------------------------------------------------- writes


def test_retake_requires_stage(client, store):
    out = store.upsert_pipeline(_snapshot())
    r = client.post(
        f"/api/v1/productions/{out['production']['id']}/retake", json={},
    )
    assert r.status_code == 400
    assert "stage" in r.json()["detail"]


def test_retake_records_event(client, store):
    out = store.upsert_pipeline(_snapshot())
    r = client.post(
        f"/api/v1/productions/{out['production']['id']}/retake",
        json={"stage": "image"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "image" in body["message"]
    events = store.list_events(production_id=out["production"]["id"])
    assert any(e["kind"] == "retake" for e in events)


def test_retake_accepts_stage_name_alias(client, store):
    """Router accepts both 'stage' and 'stage_name' keys."""
    out = store.upsert_pipeline(_snapshot())
    r = client.post(
        f"/api/v1/productions/{out['production']['id']}/retake",
        json={"stage_name": "video"},
    )
    assert r.status_code == 200
    assert "video" in r.json()["message"]


def test_resume_with_empty_body_uses_default_out_dir(client, store):
    """Missing out_dir falls back to 'default' (no crash)."""
    out = store.upsert_pipeline(_snapshot())
    r = client.post(
        f"/api/v1/productions/{out['production']['id']}/resume", json={},
    )
    assert r.status_code == 200
    assert "ok" in r.json()


def test_resume_with_invalid_body_returns_200(client, store):
    """Non-JSON body is treated as empty (no crash)."""
    out = store.upsert_pipeline(_snapshot())
    r = client.post(
        f"/api/v1/productions/{out['production']['id']}/resume",
        content=b"not json",
    )
    assert r.status_code == 200
