import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.presets import build_presets_router

def test_presets_router_crud(tmp_path):
    pfile = str(tmp_path / "presets.json")
    router = build_presets_router(pfile)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    # 1. List initially empty
    resp = client.get("/api/v1/presets")
    assert resp.status_code == 200
    assert resp.json() == {"presets": []}

    # 2. Create preset
    create_payload = {
        "name": "Cinematic 720p",
        "mode": "video",
        "model_type": "flux2_klein_9b",
        "prompt": "robot walking",
    }
    resp = client.post("/api/v1/presets", json=create_payload)
    assert resp.status_code == 200
    created = resp.json()
    assert created["name"] == "Cinematic 720p"
    preset_id = created["id"]

    # 3. List contains created
    resp = client.get("/api/v1/presets")
    assert resp.status_code == 200
    assert len(resp.json()["presets"]) == 1
    assert resp.json()["presets"][0]["id"] == preset_id

    # 4. Delete preset
    resp = client.delete(f"/api/v1/presets/{preset_id}")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": preset_id}

    # 5. List is empty again
    resp = client.get("/api/v1/presets")
    assert resp.status_code == 200
    assert resp.json() == {"presets": []}

    # 6. Delete not found
    resp = client.delete(f"/api/v1/presets/{preset_id}")
    assert resp.status_code == 404
