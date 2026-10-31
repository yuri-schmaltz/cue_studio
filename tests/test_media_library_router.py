import json
import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.media_library import MediaLibrary, MediaLibraryDeps, build_media_library_router
from app.shared.utils.path_safety import resolve_safe_path


@pytest.fixture
def media(tmp_path):
    for workspace in ['alpha', 'beta']:
        (tmp_path / workspace).mkdir()
    for name in ['first.mp4', 'second.wav']:
        (tmp_path / 'alpha' / name).write_bytes(b'fixture media bytes')
    (tmp_path / 'beta' / 'other.png').write_bytes(b'other workspace')
    (tmp_path / 'alpha' / 'first.meta.json').write_text(json.dumps({'params': {'seed': 42, 'prompt': 'warm workshop'}}))
    os.utime(tmp_path / 'alpha' / 'first.mp4', (100, 100))
    os.utime(tmp_path / 'alpha' / 'second.wav', (200, 200))
    active = ['alpha']

    def safe_join(base, *parts):
        resolved = resolve_safe_path(Path(base).joinpath(*parts), [base])
        return str(resolved) if resolved else None

    library = MediaLibrary(MediaLibraryDeps(
        workspace_dir=lambda workspace=None: str(tmp_path / (workspace or active[0])),
        workspace_browse_dir=lambda workspace: str(tmp_path / workspace) if workspace in {'alpha', 'beta'} else None,
        active_workspace=lambda: active[0], projects_root=lambda: str(tmp_path),
        safe_join=safe_join, extract_output_seed=lambda name: None,
    ))
    app = FastAPI()
    app.include_router(build_media_library_router(library))
    with TestClient(app) as client:
        yield client, active


def test_output_pagination_and_metadata(media):
    client, _ = media
    response = client.get('/api/v1/outputs', params={'limit': 1, 'offset': 1})
    assert response.status_code == 200
    assert response.json()['total'] == 2
    assert [item['name'] for item in response.json()['outputs']] == ['first.mp4']
    metadata = client.get('/api/v1/outputs/first.mp4/metadata').json()
    assert metadata['source'] == 'sidecar'
    assert metadata['params']['seed'] == 42


def test_favorites_are_isolated_and_filter_outputs(media):
    client, active = media
    assert client.post('/api/v1/favorites/first.mp4').json()['favorite'] is True
    outputs = client.get('/api/v1/outputs', params={'favorites_only': True}).json()
    assert [item['name'] for item in outputs['outputs']] == ['first.mp4']
    active[0] = 'beta'
    assert client.get('/api/v1/favorites').json() == {'favorites': []}
    active[0] = 'alpha'
    assert client.post('/api/v1/favorites/first.mp4').json()['favorite'] is False


def test_browsing_does_not_switch_workspace_or_fall_back_to_another(media):
    client, active = media
    response = client.get('/api/v1/outputs', params={'workspace': 'beta'})
    assert [item['name'] for item in response.json()['outputs']] == ['other.png']
    assert active[0] == 'alpha'
    assert client.get('/api/v1/file/first.mp4', params={'workspace': 'beta'}).status_code == 404
    assert client.get('/api/v1/outputs', params={'workspace': '../outside'}).status_code == 400


def test_media_response_preserves_range_requests(media):
    client, _ = media
    response = client.get('/api/v1/file/first.mp4', headers={'Range': 'bytes=0-6'})
    assert response.status_code == 206
    assert response.content == b'fixture'
    assert response.headers['content-range'] == 'bytes 0-6/19'
