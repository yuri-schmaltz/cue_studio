"""A16 — workspaces (projects) domain router, built with injected fakes.

Verifies the extracted ``app/routers/workspaces`` package serves the same
URLs with the same behaviour the inline ``launch.py`` handlers had.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.workspaces import WorkspaceDeps, build_workspaces_router


class FakeWorkspaceSetupError(Exception):
    """Mirrors services.WorkspaceSetupError (has status_code + detail)."""

    def __init__(self, detail: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@pytest.fixture
def state(tmp_path: Path):
    return {
        "workspaces": [{"name": "default", "path": str(tmp_path / "outputs")}],
        "active": "default",
        "setups": {"default": {}},
        "jobs": {},
        "active_gen_states": {},
        "covers": {},
        "drafts": {},
        "root": tmp_path,
        "deleted": [],
    }


@pytest.fixture
def client(state):
    def persist_active(name, apply_save_paths=True):
        state["active"] = name
        return str(state["root"] / name)

    deps = WorkspaceDeps(
        list_workspaces=lambda: list(state["workspaces"]),
        get_active_workspace=lambda: state["active"],
        persist_active_workspace=persist_active,
        active_gen_states=lambda: state["active_gen_states"],
        jobs=lambda: state["jobs"],
        projects_root=lambda: str(state["root"]),
        workspace_dir=lambda name: str(state["root"] / name),
        load_workspace_setup=lambda name: dict(state["setups"].get(name, {})),
        persist_workspace_setup=lambda name, setup: (
            state["setups"].__setitem__(name, dict(setup)) or dict(setup)
        ),
        save_cover_image=lambda base, name, content, filename: (
            state["covers"].__setitem__(filename, content) or f"covers/{filename}"
        ),
        delete_cover_image=lambda base, name, filename=None: state["covers"].pop(
            filename or "", None
        ),
        cover_image_path=lambda base, name, filename: (
            str(Path(base) / filename) if (Path(base) / filename).is_file() else None
        ),
        safe_join=lambda base, name: str(Path(base) / name),
        workspace_setup_error=FakeWorkspaceSetupError,
        load_director_draft=lambda name: state["drafts"].get(name),
        persist_director_draft=lambda name, draft: (
            state["drafts"].__setitem__(name, dict(draft)) or dict(draft)
        ),
        delete_director_draft=lambda name: bool(state["drafts"].pop(name, None)),
    )
    app = FastAPI()
    app.include_router(build_workspaces_router(deps))
    return TestClient(app)


# ------------------------------------------------------------------ list


def test_list_returns_workspaces_and_active(client, state):
    response = client.get("/api/v1/workspaces")
    assert response.status_code == 200
    assert response.json() == {"workspaces": state["workspaces"], "active": "default"}


def test_set_active_workspace(client, state):
    response = client.put("/api/v1/workspaces/active", json={"name": "meu-filme"})
    assert response.status_code == 200
    assert response.json()["active"] == "meu-filme"
    assert state["active"] == "meu-filme"


def test_set_active_rejects_invalid_name(client):
    response = client.put("/api/v1/workspaces/active", json={"name": "../etc"})
    assert response.status_code == 400


# --------------------------------------------------------------- create


def test_create_workspace(client, state, tmp_path):
    response = client.post("/api/v1/workspaces", json={"name": "novo"})
    assert response.status_code == 200
    assert response.json()["name"] == "novo"
    assert (tmp_path / "novo").is_dir()


def test_create_requires_name(client):
    assert client.post("/api/v1/workspaces", json={"name": "  "}).status_code == 400
    assert client.post("/api/v1/workspaces", json={"name": "bad name!"}).status_code == 400


# ---------------------------------------------------------------- setup


def test_setup_roundtrip(client):
    payload = {"aspect_ratio": "16:9", "resolution": "1280x720"}
    put = client.put("/api/v1/workspaces/default/setup", json={"setup": payload})
    assert put.status_code == 200
    assert put.json()["setup"] == payload
    got = client.get("/api/v1/workspaces/default/setup")
    assert got.json()["setup"] == payload


def test_setup_accepts_unwrapped_body(client):
    put = client.put("/api/v1/workspaces/default/setup", json={"aspect_ratio": "21:9"})
    assert put.status_code == 200
    assert put.json()["setup"] == {"aspect_ratio": "21:9"}


# --------------------------------------------------------------- cover


def test_cover_upload_serve_delete(client, state):
    upload = client.post(
        "/api/v1/workspaces/default/cover",
        files={"file": ("cartaz.png", b"png-bytes", "image/png")},
    )
    assert upload.status_code == 200
    assert upload.json()["cover_image"] == "covers/cartaz.png"

    served = client.get("/api/v1/workspaces/default/cover")
    assert served.status_code == 404  # fake cover_image_path has no real file

    removed = client.delete("/api/v1/workspaces/default/cover")
    assert removed.status_code == 200
    assert removed.json()["setup"]["cover_image"] == ""


def test_cover_missing_is_404(client):
    assert client.get("/api/v1/workspaces/ghost/cover").status_code == 404


# --------------------------------------------------------------- delete


def test_delete_default_is_refused(client):
    response = client.delete("/api/v1/workspaces/default")
    assert response.status_code == 400
    assert "cannot be deleted" in response.json()["detail"]


def test_delete_unknown_is_404(client):
    response = client.delete("/api/v1/workspaces/ghost")
    assert response.status_code == 404


def test_delete_busy_is_409(client, state, tmp_path):
    (tmp_path / "ocupado").mkdir()
    state["jobs"] = {"j1": {"status": "running"}}
    response = client.delete("/api/v1/workspaces/ocupado")
    assert response.status_code == 409


def test_delete_removes_folder(client, state, tmp_path):
    (tmp_path / "antigo").mkdir()
    (tmp_path / "antigo" / "clip.mp4").write_bytes(b"x")
    response = client.delete("/api/v1/workspaces/antigo")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["name"] == "antigo"
    assert not (tmp_path / "antigo").exists()


# -------------------------------------------------------- director draft


def test_director_draft_lifecycle(client, state):
    # 1. Initial state: no draft
    resp = client.get("/api/v1/workspaces/proj1/director-draft")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "name": "proj1", "draft": None}

    # 2. Save draft
    payload = {
        "directorStep": "scenes",
        "directorSceneDescription": "Cyberpunk night alley",
        "directorPlannedClips": [{"start": 0, "end": 4}],
    }
    put_resp = client.put("/api/v1/workspaces/proj1/director-draft", json={"draft": payload})
    assert put_resp.status_code == 200
    assert put_resp.json()["status"] == "ok"
    assert put_resp.json()["draft"] == payload

    # 3. Retrieve draft
    get_resp = client.get("/api/v1/workspaces/proj1/director-draft")
    assert get_resp.status_code == 200
    assert get_resp.json()["draft"] == payload

    # 4. Delete draft
    del_resp = client.delete("/api/v1/workspaces/proj1/director-draft")
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted"] is True

    # 5. After delete: returns None
    get_after = client.get("/api/v1/workspaces/proj1/director-draft")
    assert get_after.status_code == 200
    assert get_after.json()["draft"] is None
