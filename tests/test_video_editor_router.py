"""Tests for the video editor HTTP router."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest


@pytest.fixture
def editor_client(tmp_path: Path):
    from app.services.video_editor import VideoEditor
    from app.routers.video_editor import build_video_editor_router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    ed = VideoEditor(tmp_path / "editor")

    app = FastAPI()
    app.include_router(build_video_editor_router(lambda: ed))
    client = TestClient(app)
    return client, ed


def test_health_openapi(editor_client) -> None:
    client, _ = editor_client
    r = client.get("/openapi.json")
    assert r.status_code == 200
    paths = r.json()["paths"]
    assert "/api/v1/editor/projects" in paths


def test_create_then_get_project(editor_client) -> None:
    client, _ = editor_client
    r = client.post("/api/v1/editor/projects", json={"title": "Reel"})
    assert r.status_code == 201
    pid = r.json()["id"]
    r2 = client.get(f"/api/v1/editor/projects/{pid}")
    assert r2.status_code == 200
    assert r2.json()["title"] == "Reel"


def test_get_unknown_404(editor_client) -> None:
    client, _ = editor_client
    r = client.get("/api/v1/editor/projects/nope")
    assert r.status_code == 404


def test_list_projects(editor_client) -> None:
    client, _ = editor_client
    for title in ("A", "B"):
        client.post("/api/v1/editor/projects", json={"title": title})
    r = client.get("/api/v1/editor/projects")
    assert r.status_code == 200
    titles = [p["title"] for p in r.json()["projects"]]
    assert "A" in titles and "B" in titles


def test_delete_project(editor_client) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    r = client.delete(f"/api/v1/editor/projects/{pid}")
    assert r.status_code == 204
    assert client.get(f"/api/v1/editor/projects/{pid}").status_code == 404


def test_delete_unknown_404(editor_client) -> None:
    client, _ = editor_client
    assert client.delete("/api/v1/editor/projects/nope").status_code == 404


def test_add_clip(editor_client) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    r = client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/tmp/a.mp4", "start": 0, "end": 2},
    )
    assert r.status_code == 201
    assert len(r.json()["clips"]) == 1


def test_add_clip_rejects_missing_path(editor_client) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    r = client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"start": 0, "end": 2},
    )
    assert r.status_code == 422  # pydantic rejects missing field


def test_add_clip_unknown_project(editor_client) -> None:
    client, _ = editor_client
    r = client.post(
        "/api/v1/editor/projects/nope/clips",
        json={"media_path": "/tmp/a.mp4"},
    )
    assert r.status_code == 400


def test_remove_clip(editor_client) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    p = client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/tmp/a.mp4"},
    ).json()
    cid = p["clips"][0]["id"]
    r = client.delete(f"/api/v1/editor/projects/{pid}/clips/{cid}")
    assert r.status_code == 200
    assert r.json()["clips"] == []


def test_reorder_clips(editor_client) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    a = client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/a.mp4", "label": "a"},
    ).json()
    b = client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/b.mp4", "label": "b"},
    ).json()
    ids = [c["id"] for c in b["clips"]]
    r = client.post(
        f"/api/v1/editor/projects/{pid}/clips/reorder",
        json={"order": list(reversed(ids))},
    )
    assert r.status_code == 200
    assert [c["label"] for c in r.json()["clips"]] == ["b", "a"]


def test_trim_clip(editor_client) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    p = client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/a.mp4", "start": 0, "end": 10},
    ).json()
    cid = p["clips"][0]["id"]
    r = client.post(
        f"/api/v1/editor/projects/{pid}/clips/{cid}/trim",
        json={"start": 1, "end": 4},
    )
    assert r.status_code == 200
    assert r.json()["clips"][0]["end"] == 4


def test_split_clip(editor_client) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    p = client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/a.mp4", "start": 0, "end": 10},
    ).json()
    cid = p["clips"][0]["id"]
    r = client.post(
        f"/api/v1/editor/projects/{pid}/clips/{cid}/split",
        json={"at_seconds": 4.0},
    )
    assert r.status_code == 200
    assert len(r.json()["clips"]) == 2


def test_export_project_via_stub_wgp(editor_client, monkeypatch) -> None:
    client, ed = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/a.mp4"},
    )

    # Stub wgp in sys.modules to avoid the full WanGP runtime.
    fake = types.ModuleType("app.wgp")

    def fake_concat(clip_paths, output_path, **_kw):
        Path(output_path).write_bytes(b"ok")
        return True

    fake.concatenate_multi_clip_videos = fake_concat  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "app.wgp", fake)

    # output_path must live inside editor.root (path-traversal guard).
    out = ed.root / "joined.mp4"
    r = client.post(
        f"/api/v1/editor/projects/{pid}/export",
        json={"output_path": str(out)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "completed"
    assert out.exists()


def test_export_rejects_path_outside_root(editor_client, monkeypatch) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/a.mp4"},
    )
    # Stub wgp so we don't accidentally exercise real ffmpeg on the rejected path.
    fake = types.ModuleType("app.wgp")
    fake.concatenate_multi_clip_videos = lambda *a, **k: True  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "app.wgp", fake)

    r = client.post(
        f"/api/v1/editor/projects/{pid}/export",
        json={"output_path": "/tmp/escape.mp4"},
    )
    assert r.status_code == 400
    assert "inside the editor root" in r.text or "output_path" in r.text


def test_export_with_empty_body_defaults_to_root(editor_client, monkeypatch) -> None:
    """An empty body defaults output_path to ``<editor.root>/<id>.mp4``."""
    client, ed = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    client.post(
        f"/api/v1/editor/projects/{pid}/clips",
        json={"media_path": "/a.mp4"},
    )
    fake = types.ModuleType("app.wgp")

    def fake_concat(clip_paths, output_path, **_kw):
        Path(output_path).write_bytes(b"ok")
        return True

    fake.concatenate_multi_clip_videos = fake_concat  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "app.wgp", fake)

    r = client.post(f"/api/v1/editor/projects/{pid}/export", json={})
    assert r.status_code == 200, r.text
    default_target = ed.root / f"{pid}.mp4"
    assert default_target.exists()


def test_export_empty_project_400(editor_client) -> None:
    client, _ = editor_client
    pid = client.post("/api/v1/editor/projects", json={"title": "x"}).json()["id"]
    r = client.post(f"/api/v1/editor/projects/{pid}/export", json={})
    assert r.status_code == 400


def test_export_unknown_project_400(editor_client) -> None:
    client, _ = editor_client
    r = client.post("/api/v1/editor/projects/nope/export", json={})
    assert r.status_code == 400


def test_get_editor_returns_none_503() -> None:
    from app.routers.video_editor import build_video_editor_router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(build_video_editor_router(lambda: None))
    client = TestClient(app)
    r = client.get("/api/v1/editor/projects")
    assert r.status_code == 503
