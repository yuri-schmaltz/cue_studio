"""Tests for the editor_list_projects + editor_export MCP tools."""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

from app.services.mcp_dispatcher import make_dispatch
from app.services.mcp_tools import build_default_registry


@pytest.fixture
def dispatch():
    """Default-registered dispatch with all curated tools."""
    return make_dispatch(build_default_registry())


@pytest.fixture
def editor_root(tmp_path: Path, monkeypatch):
    """Patch the default VideoEditor root so tools see a temp dir."""
    from app.services import video_editor

    root = tmp_path / "editor"
    monkeypatch.setattr(video_editor, "_default_root", lambda: root)
    return root


def _stub_wgp(monkeypatch, output_bytes: bytes = b"ok") -> list:
    """Inject a fake ``app.wgp`` module so editor.export doesn't trigger
    the real WanGP runtime. Returns the call-list for assertions."""
    calls: list = []

    def fake_concat(clip_paths, output_path, **_kw):
        calls.append({"clips": list(clip_paths), "out": output_path})
        Path(output_path).write_bytes(output_bytes)
        return True

    fake = types.ModuleType("app.wgp")
    fake.concatenate_multi_clip_videos = fake_concat  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "app.wgp", fake)
    return calls


def test_tools_are_registered() -> None:
    reg = build_default_registry()
    assert reg.has("editor_list_projects")
    assert reg.has("editor_export")


@pytest.mark.asyncio
async def test_editor_list_projects_empty(dispatch, editor_root) -> None:
    resp = await dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                            "params": {"name": "editor_list_projects", "arguments": {}}})
    payload = resp.payload
    assert payload["id"] == 1
    result = json.loads(payload["result"]["content"][0]["text"])
    assert result == {"count": 0, "projects": []}


@pytest.mark.asyncio
async def test_editor_list_projects_returns_created(dispatch, editor_root) -> None:
    from app.services.video_editor import VideoEditor

    ed = VideoEditor(editor_root)
    ed.create_project(title="Reel")
    ed.create_project(title="Trailer")

    resp = await dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                            "params": {"name": "editor_list_projects", "arguments": {"limit": 5}}})
    result = json.loads(resp.payload["result"]["content"][0]["text"])
    assert result["count"] == 2
    titles = [p["title"] for p in result["projects"]]
    assert set(titles) == {"Reel", "Trailer"}


@pytest.mark.asyncio
async def test_editor_list_projects_validates_limit(dispatch, editor_root) -> None:
    resp = await dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                            "params": {"name": "editor_list_projects",
                                       "arguments": {"limit": "not-a-number"}}})
    payload = resp.payload or {}
    if "error" in payload:
        body = payload["error"]
    else:
        text = payload["result"]["content"][0]["text"]
        try:
            body = json.loads(text)
        except ValueError:
            body = text
    assert "limit" in str(body).lower() or "integer" in str(body).lower()


@pytest.mark.asyncio
async def test_editor_export_missing_project_id(dispatch, editor_root) -> None:
    resp = await dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                            "params": {"name": "editor_export", "arguments": {}}})
    payload = resp.payload or {}
    if "error" in payload:
        body = payload["error"]
    else:
        text = payload["result"]["content"][0]["text"]
        body = text  # McpToolError path returns plain text
    assert "project_id" in str(body).lower()


@pytest.mark.asyncio
async def test_editor_export_runs_wgp_concat(
    dispatch, editor_root, tmp_path: Path, monkeypatch,
) -> None:
    from app.services.video_editor import VideoEditor

    ed = VideoEditor(editor_root)
    project = ed.create_project(title="Reel")
    ed.add_clip(project["id"], {"media_path": "/tmp/a.mp4"})
    ed.add_clip(project["id"], {"media_path": "/tmp/b.mp4"})

    calls = _stub_wgp(monkeypatch)

    out = tmp_path / "joined.mp4"
    resp = await dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                            "params": {"name": "editor_export",
                                       "arguments": {"project_id": project["id"],
                                                     "output_path": str(out)}}})
    assert resp.payload is not None, resp
    assert "result" in resp.payload, resp.payload
    result = json.loads(resp.payload["result"]["content"][0]["text"])
    assert result["state"] == "completed"
    assert result["output_path"] == str(out)
    assert calls == [{"clips": ["/tmp/a.mp4", "/tmp/b.mp4"], "out": str(out)}]


@pytest.mark.asyncio
async def test_editor_export_unknown_project(dispatch, editor_root) -> None:
    resp = await dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                            "params": {"name": "editor_export",
                                       "arguments": {"project_id": "nope"}}})
    payload = resp.payload or {}
    if "error" in payload:
        body = payload["error"]
    else:
        text = payload["result"]["content"][0]["text"]
        try:
            body = json.loads(text)
        except ValueError:
            body = text
    assert "nope" in str(body) or "not found" in str(body).lower() or "export failed" in str(body).lower()
