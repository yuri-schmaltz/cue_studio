"""Tests for the VideoEditor backend."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services.video_editor import EditorError, PROJECT_STATES, VideoEditor


@pytest.fixture
def editor(tmp_path: Path) -> VideoEditor:
    return VideoEditor(tmp_path / "editor")


def _clip(**overrides):
    base = {
        "media_path": "/tmp/a.mp4",
        "start": 0.0,
        "end": 5.0,
        "label": "shot",
    }
    base.update(overrides)
    return base


# ----------------------------------------------------------------- basics


def test_create_project_persists(editor: VideoEditor) -> None:
    p = editor.create_project(title="My edit")
    assert p["title"] == "My edit"
    assert p["state"] == "prepared"
    assert p["clips"] == []
    on_disk = json.loads((editor.root / f"{p['id']}.json").read_text())
    assert on_disk["id"] == p["id"]


def test_list_projects_sorted_newest_first(editor: VideoEditor) -> None:
    a = editor.create_project(title="A")
    b = editor.create_project(title="B")
    listed = editor.list_projects()
    assert [p["title"] for p in listed] == ["B", "A"]


def test_list_projects_limit(editor: VideoEditor) -> None:
    for _ in range(5):
        editor.create_project()
    assert len(editor.list_projects(limit=3)) == 3


def test_get_project_unknown_returns_none(editor: VideoEditor) -> None:
    assert editor.get_project("nope") is None


def test_get_project_roundtrip(editor: VideoEditor) -> None:
    p = editor.create_project(title="X")
    p2 = editor.get_project(p["id"])
    assert p2 is not None
    assert p2["id"] == p["id"]
    assert p2["title"] == "X"


# ----------------------------------------------------------------- delete


def test_delete_project(editor: VideoEditor) -> None:
    p = editor.create_project()
    assert editor.delete_project(p["id"]) is True
    assert editor.get_project(p["id"]) is None


def test_delete_unknown_returns_false(editor: VideoEditor) -> None:
    assert editor.delete_project("nope") is False


def test_delete_rejects_path_traversal(editor: VideoEditor) -> None:
    with pytest.raises(EditorError):
        editor.delete_project("../escape")


# ----------------------------------------------------------------- clips


def test_add_clip_appends(editor: VideoEditor) -> None:
    p = editor.create_project()
    result = editor.add_clip(p["id"], _clip())
    assert len(result["clips"]) == 1
    assert result["clips"][0]["media_path"] == "/tmp/a.mp4"


def test_add_clip_rejects_missing_path(editor: VideoEditor) -> None:
    p = editor.create_project()
    with pytest.raises(EditorError):
        editor.add_clip(p["id"], {"start": 0, "end": 1})


def test_add_clip_unknown_project(editor: VideoEditor) -> None:
    with pytest.raises(EditorError):
        editor.add_clip("nope", _clip())


def test_remove_clip(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip())
    cid = p["clips"][0]["id"]
    p2 = editor.remove_clip(p["id"], cid)
    assert p2["clips"] == []


def test_remove_clip_unknown_raises(editor: VideoEditor) -> None:
    p = editor.create_project()
    with pytest.raises(EditorError):
        editor.remove_clip(p["id"], "nope")


def test_reorder_clips(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip(label="first"))
    p = editor.add_clip(p["id"], _clip(label="second"))
    ids = [c["id"] for c in p["clips"]]
    reversed_order = list(reversed(ids))
    p2 = editor.reorder_clips(p["id"], reversed_order)
    assert [c["label"] for c in p2["clips"]] == ["second", "first"]


def test_reorder_keeps_unmentioned_clips_at_end(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip(label="a"))
    p = editor.add_clip(p["id"], _clip(label="b"))
    p = editor.add_clip(p["id"], _clip(label="c"))
    ids = [c["id"] for c in p["clips"]]
    p2 = editor.reorder_clips(p["id"], [ids[2]])  # only mention c
    assert [c["label"] for c in p2["clips"]] == ["c", "a", "b"]


def test_reorder_unknown_project(editor: VideoEditor) -> None:
    with pytest.raises(EditorError):
        editor.reorder_clips("nope", [])


def test_trim_clip(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip())
    cid = p["clips"][0]["id"]
    p2 = editor.trim_clip(p["id"], cid, start=2.0, end=4.0)
    assert p2["clips"][0]["start"] == 2.0
    assert p2["clips"][0]["end"] == 4.0


def test_trim_clamps_negative(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip())
    cid = p["clips"][0]["id"]
    p2 = editor.trim_clip(p["id"], cid, start=-5.0, end=10.0)
    assert p2["clips"][0]["start"] == 0.0  # negative coerced to 0


def test_trim_reorders_end_below_start(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip(start=2.0, end=5.0))
    cid = p["clips"][0]["id"]
    p2 = editor.trim_clip(p["id"], cid, start=10.0, end=3.0)
    # end < start is clamped to start
    assert p2["clips"][0]["start"] == 10.0
    assert p2["clips"][0]["end"] == 10.0


def test_trim_unknown_clip_raises(editor: VideoEditor) -> None:
    p = editor.create_project()
    with pytest.raises(EditorError):
        editor.trim_clip(p["id"], "nope", start=0, end=1)


def test_split_clip(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip(start=0.0, end=10.0))
    cid = p["clips"][0]["id"]
    p2 = editor.split_clip(p["id"], cid, at_seconds=4.0)
    assert len(p2["clips"]) == 2
    assert p2["clips"][0]["end"] == 4.0
    assert p2["clips"][1]["start"] == 4.0
    assert p2["clips"][0]["id"] == cid  # left side keeps the original id
    assert p2["clips"][1]["id"] != cid


def test_split_outside_range_raises(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip(start=0.0, end=10.0))
    cid = p["clips"][0]["id"]
    with pytest.raises(EditorError):
        editor.split_clip(p["id"], cid, at_seconds=15.0)


def test_split_unknown_clip_raises(editor: VideoEditor) -> None:
    p = editor.create_project()
    with pytest.raises(EditorError):
        editor.split_clip(p["id"], "nope", at_seconds=1.0)


# ----------------------------------------------------------------- export


def test_export_empty_project_raises(editor: VideoEditor) -> None:
    p = editor.create_project()
    with pytest.raises(EditorError):
        editor.export(p["id"])


def test_export_unknown_project_raises(editor: VideoEditor) -> None:
    with pytest.raises(EditorError):
        editor.export("nope")


def test_export_runs_ffmpeg_concat(editor: VideoEditor, tmp_path: Path, monkeypatch) -> None:
    """When ffmpeg is available, export produces a real output file."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not on PATH")
    # Create two real tiny mp4 files via ffmpeg lavfi
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    for target, color in ((a, "red"), (b, "blue")):
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi", "-i",
                    f"color=c={color}:s=64x64:d=1", target.as_posix(),
                ],
                capture_output=True,
                check=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError):
            pytest.skip("ffmpeg lavfi not available in this environment")

    # Stub the wgp helper by patching the name in the module that does the
    # import (``app.services.video_editor``). The helper is imported lazily
    # inside export(), so we install a fake module into sys.modules.
    import sys
    import types

    calls: list[list[str]] = []

    def fake_concat(clip_paths, output_path, **_kw):
        calls.append(list(clip_paths))
        # Create a fake output so the post-condition (file exists, size > 0)
        # holds without depending on ffmpeg.
        Path(output_path).write_bytes(b"fake-bytes")
        return True

    fake_wgp = types.ModuleType("app.wgp")
    fake_wgp.concatenate_multi_clip_videos = fake_concat  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "app.wgp", fake_wgp)
    project = editor.create_project()
    project = editor.add_clip(project["id"], {"media_path": str(a)})
    project = editor.add_clip(project["id"], {"media_path": str(b)})

    out = tmp_path / "joined.mp4"
    result = editor.export(project["id"], output_path=str(out))
    assert result["state"] == "completed"
    assert result["output_path"] == str(out)
    assert out.exists() and out.stat().st_size > 0
    # wgp was called with both clips in order
    assert calls == [[str(a), str(b)]]


def test_ffmpeg_available_reflects_path(editor: VideoEditor, monkeypatch) -> None:
    monkeypatch.setenv("FFMPEG_BINARY", "/no/such/binary")
    assert editor.ffmpeg_available() is False


# ----------------------------------------------------------------- sanitization


def test_clip_label_truncated(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], _clip(label="x" * 5000))
    assert len(p["clips"][0]["label"]) == 200


def test_clip_end_coerced_when_none(editor: VideoEditor) -> None:
    p = editor.create_project()
    p = editor.add_clip(p["id"], {"media_path": "/x.mp4", "start": 3.0})
    assert p["clips"][0]["end"] == 3.0  # falls back to start


def test_project_title_defaults(editor: VideoEditor) -> None:
    p = editor.create_project()
    assert p["title"] == "Untitled"


def test_project_state_unknown_normalized(editor: VideoEditor) -> None:
    p = editor.create_project()
    # Forge a corrupt file
    path = editor.root / f"{p['id']}.json"
    path.write_text(json.dumps({
        "id": p["id"], "title": "x", "state": "bogus", "clips": [],
    }))
    loaded = editor.get_project(p["id"])
    assert loaded is not None
    assert loaded["state"] == "prepared"


def test_corrupt_project_file_returns_none(editor: VideoEditor) -> None:
    p = editor.create_project()
    (editor.root / f"{p['id']}.json").write_text("not json")
    assert editor.get_project(p["id"]) is None


# ----------------------------------------------------------------- state


def test_project_states_constant() -> None:
    for required in ("prepared", "running", "completed", "failed", "cancelled"):
        assert required in PROJECT_STATES
