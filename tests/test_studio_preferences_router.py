"""HTTP and disk contracts for the extracted Studio preferences domain."""
import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.routers.studio_preferences import build_studio_preferences_router


@pytest.fixture
def setup(tmp_path):
    runtime = SimpleNamespace(
        server_config={"unrelated": "preserved"},
        server_config_filename=str(tmp_path / "server.json"),
    )
    app = FastAPI()
    app.include_router(build_studio_preferences_router(runtime))
    with TestClient(app) as client:
        yield runtime, client


def test_preferences_merge_survives_fresh_router(setup):
    runtime, client = setup
    assert client.get('/api/v1/studio-preferences').json() == {"configured": False}
    assert client.put('/api/v1/studio-preferences', json={"generation_mode": "image"}).status_code == 200
    result = client.put('/api/v1/studio-preferences', json={"studio_image_workflow": "outpaint"})
    assert result.json() == {
        "configured": True, "generation_mode": "image", "studio_image_workflow": "outpaint",
    }
    with open(runtime.server_config_filename) as f:
        saved = json.load(f)
    assert saved['unrelated'] == 'preserved'
    runtime.server_config = saved
    app = FastAPI()
    app.include_router(build_studio_preferences_router(runtime))
    with TestClient(app) as reopened:
        assert reopened.get('/api/v1/studio-preferences').json() == result.json()


def test_visibility_deduplicates_and_roundtrips(setup):
    runtime, client = setup
    result = client.put('/api/v1/model-visibility', json={
        "enabled_models": [" wan ", "wan", "flux"], "defaults_version": 11,
    })
    assert result.status_code == 200
    assert result.json()['enabled_models'] == ['wan', 'flux']
    assert client.get('/api/v1/model-visibility').json() == result.json()


@pytest.mark.parametrize('path,payload', [
    ('studio-preferences', {"generation_mode": "invalid"}),
    ('studio-preferences', []),
    ('model-visibility', {"enabled_models": "wan"}),
    ('h3-window-overrides', {"overrides": {"model::720p": 346}}),
])
def test_invalid_request_does_not_mutate_runtime_or_disk(setup, path, payload):
    runtime, client = setup
    assert client.put('/api/v1/' + path, json=payload).status_code == 400
    assert runtime.server_config == {"unrelated": "preserved"}
    from pathlib import Path
    assert not Path(runtime.server_config_filename).exists()


def test_h3_override_roundtrip(setup):
    _, client = setup
    value = {"overrides": {"h3::720p": 121}}
    assert client.put('/api/v1/h3-window-overrides', json=value).json() == value
    assert client.get('/api/v1/h3-window-overrides').json() == value
