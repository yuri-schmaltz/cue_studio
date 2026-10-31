from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.tools import build_tools_router


def test_tools_router_endpoints():
    app = FastAPI()
    router = build_tools_router(
        upscale_fn=lambda req: {"job_id": "up_123"},
        film_grain_fn=lambda req: {"job_id": "grain_123"},
        sharpen_fn=lambda req: {"job_id": "sharp_123"},
        revoice_fn=lambda req: {"job_id": "revoice_123"},
    )
    app.include_router(router)
    client = TestClient(app)

    res = client.post("/api/v1/tools/upscale", json={"filename": "clip.mp4"})
    assert res.status_code == 200
    assert res.json()["job_id"] == "up_123"

    res = client.post("/api/v1/tools/film-grain", json={"filename": "clip.mp4"})
    assert res.status_code == 200
    assert res.json()["job_id"] == "grain_123"

    res = client.post("/api/v1/tools/sharpen", json={"filename": "clip.mp4"})
    assert res.status_code == 200
    assert res.json()["job_id"] == "sharp_123"

    res = client.post("/api/v1/tools/revoice", json={"filename": "clip.mp4"})
    assert res.status_code == 200
    assert res.json()["job_id"] == "revoice_123"
