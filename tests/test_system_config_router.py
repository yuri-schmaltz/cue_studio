import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from app.routers.system_config import build_system_config_router

def test_system_config_router_routes():
    wgp = MagicMock()
    wgp.server_config = {"attention_mode": "auto"}
    wgp.args.vram_safety_coefficient = 1.0
    wgp.attention_modes_supported = ["auto", "flash_attn"]
    router = build_system_config_router(wgp, "2.5.2")

    routes = {f"{list(r.methods)[0]} {r.path}" for r in router.routes}
    assert "GET /api/v1/system-config" in routes
    assert "PUT /api/v1/system-config" in routes
    assert "GET /api/v1/system-detect" in routes
    assert "POST /api/v1/system-detect/apply" in routes
    assert "GET /api/v1/system-stats" in routes

def test_system_config_get():
    wgp = MagicMock()
    wgp.server_config = {
        "attention_mode": "auto",
        "checkpoints_paths": ["ckpts", "."],
    }
    wgp.args.vram_safety_coefficient = 1.0
    wgp.attention_modes_supported = ["auto"]
    router = build_system_config_router(wgp, "2.5.2")

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    resp = client.get("/api/v1/system-config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["app_version"] == "2.5.2"
    assert data["attention_mode"] == "auto"
