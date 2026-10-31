from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.audio import build_audio_router


def test_audio_router_endpoints():
    app = FastAPI()
    router = build_audio_router(
        upload_audio_fn=lambda req, f: {"path": "/tmp/test.wav", "filename": f.filename},
        mix_fn=lambda req: {"path": "/tmp/mixed.wav"},
        analyze_fn=lambda req: {"duration": 12.5, "tempo": 120},
        analyze_status_fn=lambda: {"status": "idle", "message": "Ready"},
        suggest_clips_fn=lambda req: {"clips": []},
        plan_structure_fn=lambda req: {"structure": []},
    )
    app.include_router(router)
    client = TestClient(app)

    # 1. Upload audio
    res = client.post("/api/v1/upload-audio", files={"file": ("test.wav", b"RIFF....WAVE", "audio/wav")})
    assert res.status_code == 200
    assert res.json()["filename"] == "test.wav"

    # 2. Audio mix
    res = client.post("/api/v1/audio/mix", json={"tracks": []})
    assert res.status_code == 200
    assert res.json()["path"] == "/tmp/mixed.wav"

    # 3. Audio analyze
    res = client.post("/api/v1/audio/analyze", json={"audio_path": "/tmp/test.wav"})
    assert res.status_code == 200
    assert res.json()["tempo"] == 120

    # 4. Audio analyze status
    res = client.get("/api/v1/audio/analyze/status")
    assert res.status_code == 200
    assert res.json()["status"] == "idle"

    # 5. Suggest clips
    res = client.post("/api/v1/audio/suggest-clips", json={"audio_path": "/tmp/test.wav"})
    assert res.status_code == 200
    assert "clips" in res.json()

    # 6. Plan structure
    res = client.post("/api/v1/audio/plan-structure", json={"audio_path": "/tmp/test.wav"})
    assert res.status_code == 200
    assert "structure" in res.json()
