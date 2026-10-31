from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.civitai import build_civitai_router


def test_civitai_router_endpoints():
    app = FastAPI()
    router = build_civitai_router(
        model_filters=[{"label": "Test Filter", "baseModels": "Test"}],
        list_checkpoint_architectures_fn=lambda base: [{"architecture": "test_arch"}],
        suggested_checkpoint_architecture_fn=lambda base: "test_arch",
        checkpoint_targets_for_base_fn=lambda base: ["test_arch"],
        unsupported_checkpoint_reason_fn=lambda base: None,
        search_fn=lambda **kwargs: {"items": []},
        model_detail_fn=lambda mid: {"id": mid, "modelVersions": []},
        download_fn=lambda req: {"download_id": "dl123", "status": "downloading"},
        downloads_status_fn=lambda: {"downloads": []},
    )
    app.include_router(router)
    client = TestClient(app)

    # 1. Base models
    res = client.get("/api/v1/civitai/base-models")
    assert res.status_code == 200
    assert res.json() == {"filters": [{"label": "Test Filter", "baseModels": "Test"}]}

    # 2. Checkpoint architectures
    res = client.get("/api/v1/civitai/checkpoint-architectures?base_model=Test")
    assert res.status_code == 200
    assert res.json()["suggested_architecture"] == "test_arch"
    assert res.json()["supported"] is True

    # 3. Search
    res = client.get("/api/v1/civitai/search?query=cyber")
    assert res.status_code == 200
    assert res.json() == {"items": []}

    # 4. Model details
    res = client.get("/api/v1/civitai/model/42")
    assert res.status_code == 200
    assert res.json()["id"] == 42

    # 5. Download
    res = client.post("/api/v1/civitai/download", json={"download_url": "https://civitai.com/api/download/models/123"})
    assert res.status_code == 200
    assert res.json()["download_id"] == "dl123"

    # 6. Downloads status
    res = client.get("/api/v1/civitai/downloads")
    assert res.status_code == 200
    assert res.json() == {"downloads": []}
