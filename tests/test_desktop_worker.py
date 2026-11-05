"""Private desktop transport retains same-origin media and rejects foreign callers."""
import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.testclient import TestClient
from app.desktop_worker import DesktopSessionMiddleware

TOKEN = 'private-desktop-session-' + 'a' * 40
PORT = 12345
BASE = f'http://127.0.0.1:{PORT}'


@pytest.fixture
def client(tmp_path):
    api = FastAPI()
    media = tmp_path / 'media.bin'
    media.write_bytes(b'0123456789')

    @api.get('/')
    def home():
        return {'ui': 'ready'}

    @api.get('/media')
    def file():
        return FileResponse(media)

    return TestClient(DesktopSessionMiddleware(api, token=TOKEN, port=PORT, instance='owned-worker'), base_url=BASE)


def test_unrelated_local_clients_cannot_read_ui_or_media(client):
    assert client.get('/').status_code == 401
    assert client.get('/media').status_code == 401
    assert client.get('/__desktop/status').status_code == 401
    assert client.get('/__desktop/bootstrap/wrong-secret').status_code == 401


def test_bootstrap_establishes_private_cookie_without_exposing_secret_to_js(client):
    response = client.get('/__desktop/bootstrap/' + TOKEN, follow_redirects=False)
    assert response.status_code == 200
    assert '?stage=authorize' in response.text
    assert 'set-cookie' not in response.headers
    response = client.get('/__desktop/bootstrap/' + TOKEN + '?stage=authorize')
    assert 'HttpOnly' in response.headers['set-cookie']
    assert 'SameSite=strict' in response.headers['set-cookie']
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert client.get('/').json() == {'ui': 'ready'}
    status = client.get('/__desktop/status').json()
    assert status == {'instance': 'owned-worker', 'pid': os.getpid()}
    assert TOKEN not in str(status)


def test_cookie_media_supports_native_range_requests(client):
    client.get('/__desktop/bootstrap/' + TOKEN + '?stage=authorize')
    response = client.get('/media', headers={'Range': 'bytes=2-5'})
    assert response.status_code == 206
    assert response.content == b'2345'


def test_origin_rejection_applies_even_with_a_valid_session(client):
    client.get('/__desktop/bootstrap/' + TOKEN + '?stage=authorize')
    assert client.get('/', headers={'Origin': 'https://foreign.example'}).status_code == 403
    assert client.get('/', headers={'Origin': BASE}).status_code == 200


def test_supervisor_can_authenticate_before_cookie_bootstrap(client):
    assert client.get('/__desktop/status', headers={'x-cue-desktop-token': TOKEN}).status_code == 200
    assert client.get('/__desktop/status', headers={'x-cue-desktop-token': 'other'}).status_code == 401
