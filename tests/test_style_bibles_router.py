import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.style_bibles import build_style_bibles_router

def test_style_bibles_router_structure():
    router = build_style_bibles_router()
    routes = {f"{list(r.methods)[0]} {r.path}" for r in router.routes}
    assert "GET /api/v1/style-bibles" in routes
    assert "GET /api/v1/style-bibles/{bible_id}" in routes
    assert "PUT /api/v1/style-bibles/{bible_id}" in routes
    assert "POST /api/v1/style-bibles" in routes
    assert "DELETE /api/v1/style-bibles/{bible_id}" in routes
    assert "POST /api/v1/style-bibles/{bible_id}/build" in routes

def test_style_bibles_router_list_empty(monkeypatch):
    from unittest.mock import MagicMock
    import app.services.style_bible as sb_mod

    monkeypatch.setattr("services.style_bible.list_bibles", lambda: [])
    app = FastAPI()
    app.include_router(build_style_bibles_router())
    client = TestClient(app)
    resp = client.get("/api/v1/style-bibles")
    assert resp.status_code == 200
    assert resp.json() == {"bibles": []}
