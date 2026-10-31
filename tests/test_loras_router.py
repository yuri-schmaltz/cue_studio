from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.loras import build_loras_router


def test_loras_router_endpoints():
    app = FastAPI()
    router = build_loras_router(
        scan_status_fn=lambda sid: {"status": "complete", "scan_id": sid},
        list_directories_fn=lambda: {"directories": ["flux", "ltx"]},
        preview_fn=lambda fn: {"preview": fn},
        installed_fn=lambda: {"loras": []},
        delete_file_fn=lambda d, f: {"deleted": True, "filename": f},
        list_loras_fn=lambda mt: {"loras": ["lora1.safetensors"], "guidance_max_phases": 1},
        list_loras_details_fn=lambda mt: {"loras": [{"filename": "lora1.safetensors"}], "guidance_max_phases": 1},
        nsfw_override_fn=lambda req: {"filename": "l1", "nsfw": True, "nsfw_overridden": True},
        check_updates_fn=lambda force: {"checked": 1, "updates_available": 0},
        update_manifest_fn=lambda: {"entries": {}},
        generate_guide_fn=lambda req: {"guide": "Usage guide", "recommended_weights": [1.0]},
        get_guide_fn=lambda mt, fn: {"guide": "Existing guide"},
        scan_and_generate_guides_fn=lambda req: {"status": "complete"},
    )
    app.include_router(router)
    client = TestClient(app)

    # 1. scan status
    res = client.get("/api/v1/loras/scan-status/s123")
    assert res.status_code == 200
    assert res.json()["scan_id"] == "s123"

    # 2. directories
    res = client.get("/api/v1/loras/directories")
    assert res.status_code == 200
    assert "flux" in res.json()["directories"]

    # 3. installed
    res = client.get("/api/v1/loras/installed")
    assert res.status_code == 200
    assert res.json() == {"loras": []}

    # 4. delete file
    res = client.delete("/api/v1/loras/file?directory=.&filename=test.safetensors")
    assert res.status_code == 200
    assert res.json()["deleted"] is True

    # 5. list loras by model
    res = client.get("/api/v1/loras/wan2_1")
    assert res.status_code == 200
    assert res.json()["loras"] == ["lora1.safetensors"]

    # 6. list details
    res = client.get("/api/v1/loras/wan2_1/details")
    assert res.status_code == 200
    assert len(res.json()["loras"]) == 1

    # 7. nsfw override
    res = client.post("/api/v1/loras/nsfw-override", json={"filename": "l1", "nsfw": True})
    assert res.status_code == 200
    assert res.json()["nsfw_overridden"] is True

    # 8. check updates
    res = client.post("/api/v1/loras/check-updates?force=true")
    assert res.status_code == 200
    assert res.json()["checked"] == 1

    # 9. update manifest
    res = client.get("/api/v1/loras/update-manifest")
    assert res.status_code == 200
    assert "entries" in res.json()

    # 10. get guide
    res = client.get("/api/v1/loras/wan2_1/l1.safetensors/guide")
    assert res.status_code == 200
    assert res.json()["guide"] == "Existing guide"
