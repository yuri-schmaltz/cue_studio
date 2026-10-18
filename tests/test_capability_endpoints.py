"""A34 — endpoints REST /api/v1/capabilities (spec 37 §5)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.capabilities import build_capabilities_router, _installed_model_ids


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(
        build_capabilities_router(
            models_fetcher=lambda: [{"model_type": "ltx25_distilled"}],
        )
    )
    return TestClient(app)


def test_list_models_annotates_catalog(client):
    resp = client.get("/api/v1/capabilities/models")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 14
    by_model = {m["model_id"]: m for m in body["models"]}
    assert by_model["ltx25_distilled"]["in_catalog"] is True
    assert by_model["qwen3_tts"]["in_catalog"] is False
    assert by_model["minimax_h3_omni_pruned"]["capabilities"] == sorted(
        by_model["minimax_h3_omni_pruned"]["capabilities"]
    )


def test_list_models_without_fetcher_omits_in_catalog():
    app = FastAPI()
    app.include_router(build_capabilities_router())
    with TestClient(app) as client:
        body = client.get("/api/v1/capabilities/models").json()
        assert "in_catalog" not in body["models"][0]


def test_model_runtimes_endpoint(client):
    resp = client.get("/api/v1/capabilities/models/qwen3_tts/runtimes")
    assert resp.status_code == 200
    body = resp.json()
    assert body["model_id"] == "qwen3_tts"
    assert body["runtimes"][0]["runtime"] == "comfy"
    assert body["runtimes"][0]["modes"] == ["speech"]
    assert "audio_generate" in body["runtimes"][0]["capabilities"]


def test_model_runtimes_404_for_unknown_model(client):
    resp = client.get("/api/v1/capabilities/models/nope/runtimes")
    assert resp.status_code == 404


def test_check_endpoint_true(client):
    resp = client.get(
        "/api/v1/capabilities/check",
        params={
            "model": "minimax_h3_omni_pruned",
            "runtime": "wan_gp",
            "mode": "t2v",
            "cap": "audio_generate",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["available"] is True


def test_check_endpoint_false_for_unknown_model(client):
    resp = client.get(
        "/api/v1/capabilities/check",
        params={
            "model": "ghost_model", "runtime": "wan_gp",
            "mode": "t2v", "cap": "text_to_video",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["available"] is False


def test_check_endpoint_422_for_unknown_capability(client):
    resp = client.get(
        "/api/v1/capabilities/check",
        params={
            "model": "ltx25_distilled", "runtime": "wan_gp",
            "mode": "t2v", "cap": "teleportation",
        },
    )
    assert resp.status_code == 422


def test_check_endpoint_422_for_unknown_runtime(client):
    resp = client.get(
        "/api/v1/capabilities/check",
        params={
            "model": "ltx25_distilled", "runtime": "quantum",
            "mode": "t2v", "cap": "text_to_video",
        },
    )
    assert resp.status_code == 422


def test_installed_model_ids_helper_formats():
    assert _installed_model_ids([{"model_type": "a"}, "b"]) == {"a", "b"}
    assert _installed_model_ids({"models": [{"id": "c"}]}) == {"c"}
    assert _installed_model_ids(None) == set()
