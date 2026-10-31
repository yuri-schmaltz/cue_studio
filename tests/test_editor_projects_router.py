"""Document persistence contracts without importing the GPU runtime."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.editor_projects import build_editor_projects_router


@pytest.fixture
def client(tmp_path):
    app = FastAPI()
    app.include_router(build_editor_projects_router(
        save_root=lambda: str(tmp_path / "projects"),
        uploads_root=lambda: str(tmp_path / "uploads"),
        active_workspace=lambda: "alpha",
    ))
    with TestClient(app) as client:
        yield client


def test_project_round_trip_and_workspace_isolation(client):
    created = client.post("/api/v1/editor/projects", json={"name": "Film", "canvas": {"fps": 24}})
    assert created.status_code == 200
    project = created.json()
    pid = project["id"]
    assert project["canvas"]["fps"] == 24
    path = f"/api/v1/editor/projects/{pid}"
    assert client.get(path).json()["name"] == "Film"
    assert client.get(path, params={"workspace": "beta"}).status_code == 404
    assert len(client.get("/api/v1/editor/projects").json()["projects"]) == 1
    project["name"] = "Final cut"
    assert client.put(path, json={"project": project}).status_code == 200
    assert client.get(path).json()["name"] == "Final cut"
    assert client.delete(path).json() == {"deleted": pid}
    assert client.get(path).status_code == 404
    assert client.delete(path).status_code == 404


def test_invalid_workspace_cannot_escape_storage(client):
    response = client.post("/api/v1/editor/projects", json={"workspace": "../outside"})
    assert response.status_code == 400


def test_missing_media_returns_client_error(client):
    response = client.post("/api/v1/editor/media/probe", json={"asset": {"path": "missing.mp4"}})
    assert response.status_code == 400


def test_invalid_canvas_is_a_client_error(client):
    response = client.post("/api/v1/editor/projects", json={"canvas": {"fps": "invalid"}})
    assert response.status_code == 400
