"""Exercise the upload deletion route without importing the GPU engine."""
import ast
import os
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


@pytest.fixture
def endpoint(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    uploads = tmp_path / 'uploads'
    uploads.mkdir()
    source = Path(__file__).resolve().parents[1] / 'app/launch.py'
    tree = ast.parse(source.read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'_safe_join', 'delete_upload'}]
    api = FastAPI()
    scope = {'os': os, 'HTTPException': HTTPException, 'api': api}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), scope)
    return TestClient(api), uploads, scope


def test_deletes_only_selected_upload_and_tolerates_missing(endpoint):
    client, uploads, _ = endpoint
    (uploads / 'old.png').write_bytes(b'old')
    (uploads / 'keep.png').write_bytes(b'keep')
    assert client.delete('/api/v1/uploads/old.png').status_code == 200
    assert not (uploads / 'old.png').exists()
    assert (uploads / 'keep.png').read_bytes() == b'keep'
    assert client.delete('/api/v1/uploads/old.png').status_code == 200


def test_rejects_path_escape_and_directory(endpoint):
    client, uploads, scope = endpoint
    outside = uploads.parent / 'outside.png'
    outside.write_bytes(b'keep')
    (uploads / 'escape.png').symlink_to(outside)
    assert client.delete('/api/v1/uploads/escape.png').status_code == 400
    assert outside.read_bytes() == b'keep'
    (uploads / 'directory').mkdir()
    assert client.delete('/api/v1/uploads/directory').status_code == 400
    with pytest.raises(HTTPException) as error:
        scope['delete_upload']('../outside.png')
    assert error.value.status_code == 400


def test_reports_locked_files(endpoint, monkeypatch):
    import services.win_safe_files as safe_files
    client, uploads, _ = endpoint
    (uploads / 'locked.png').write_bytes(b'keep')
    monkeypatch.setattr(safe_files, 'safe_delete', Mock(return_value={'deleted': False, 'reason': 'locked'}))
    response = client.delete('/api/v1/uploads/locked.png')
    assert response.status_code == 409
    assert (uploads / 'locked.png').exists()
