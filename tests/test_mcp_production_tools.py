"""Tests for the productions_list + production_get MCP tools."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.mcp_dispatcher import make_dispatch
from app.services.mcp_tools import build_default_registry


@pytest.fixture
def dispatch():
    """Default-registered dispatch with all curated tools."""
    return make_dispatch(build_default_registry())


@pytest.fixture
def store(tmp_path: Path, monkeypatch):
    """Patch the default ProductionStore path so tools see a temp DB."""
    from app.services import production_store

    store_path = tmp_path / "productions.sqlite3"
    monkeypatch.setattr(production_store, "_default_db_path", lambda: store_path)
    return production_store.ProductionStore(store_path)


def _snapshot(pipeline_id: str = "pipe-1", **overrides):
    base = {
        "pipeline_id": pipeline_id,
        "pipeline_type": "music_video",
        "status": "failed",
        "workspace": "ws-1",
        "created_at": "2026-09-28T10:00:00+00:00",
        "updated_at": "2026-09-28T10:05:00+00:00",
        "clip_count": 6,
        "stages": [],
        "output_files": [],
        "attempt": 1,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_productions_list_returns_empty_when_no_data(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "productions_list", "arguments": {}},
    })
    assert result.payload["result"]["isError"] is False
    text = result.payload["result"]["content"][0]["text"]
    assert '"count": 0' in text


@pytest.mark.asyncio
async def test_productions_list_returns_persisted(dispatch, store) -> None:
    store.upsert_pipeline(_snapshot(pipeline_id="p1"))
    store.upsert_pipeline(_snapshot(pipeline_id="p2"))
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "productions_list", "arguments": {"limit": 10}},
    })
    text = result.payload["result"]["content"][0]["text"]
    assert '"count": 2' in text


@pytest.mark.asyncio
async def test_productions_list_filter_by_status(dispatch, store) -> None:
    store.upsert_pipeline(_snapshot(pipeline_id="p1", status="failed"))
    store.upsert_pipeline(_snapshot(pipeline_id="p2", status="completed"))
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "productions_list", "arguments": {"status": "completed"}},
    })
    text = result.payload["result"]["content"][0]["text"]
    assert '"count": 1' in text


@pytest.mark.asyncio
async def test_productions_list_rejects_invalid_limit(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "productions_list", "arguments": {"limit": "not-a-number"}},
    })
    assert result.payload["result"]["isError"] is True
    assert "limit" in result.payload["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_production_get_requires_id(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "production_get", "arguments": {}},
    })
    assert result.payload["result"]["isError"] is True
    assert "production_id" in result.payload["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_production_get_unknown_raises(dispatch, store) -> None:
    # monkey-patched store is the only one that sees the data; with no
    # upsert, lookup should fail.
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "production_get", "arguments": {"production_id": "nope"}},
    })
    assert result.payload["result"]["isError"] is True
    assert "not found" in result.payload["result"]["content"][0]["text"].lower()


@pytest.mark.asyncio
async def test_production_get_returns_production_and_runs(dispatch, store) -> None:
    store.upsert_pipeline(_snapshot(pipeline_id="p1", attempt=1))
    out = store.upsert_pipeline(_snapshot(pipeline_id="p1", attempt=2))
    prod_id = out["production"]["id"]
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "production_get", "arguments": {"production_id": prod_id}},
    })
    assert result.payload["result"]["isError"] is False
    payload = json.loads(result.payload["result"]["content"][0]["text"])
    assert payload["production"]["id"] == prod_id
    assert len(payload["runs"]) == 2


def test_default_registry_exposes_production_tools() -> None:
    reg = build_default_registry()
    names = {t["name"] for t in reg.list_specs()}
    assert "productions_list" in names
    assert "production_get" in names
