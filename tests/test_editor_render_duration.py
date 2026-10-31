"""Real software exports must preserve the edit's final picture frame."""
import json
from pathlib import Path
import shutil
import subprocess

import pytest

from app.services.editor_projects import create_editor_project, compile_editor_render


@pytest.fixture(scope="module")
def media(tmp_path_factory):
    if not all(shutil.which(tool) for tool in ("ffmpeg", "ffprobe")):
        pytest.skip("FFmpeg and ffprobe required")
    root = tmp_path_factory.mktemp("editor-duration")
    source = root / "source.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i",
        "testsrc2=size=160x90:rate=24:duration=1", "-f", "lavfi", "-i",
        "sine=frequency=440:sample_rate=48000:duration=1",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", str(source),
    ], check=True)
    return source


@pytest.mark.parametrize("export_fps", [24, 30, 60])
def test_software_export_preserves_one_second_of_picture_and_audio(media, tmp_path, export_fps):
    project = create_editor_project(width=160, height=90, fps=24)
    project["assets"] = {"source": {
        "id": "source", "name": media.name, "path": str(media),
        "type": "video", "duration": 1, "has_audio": True,
    }}
    project["tracks"][0]["items"] = [{
        "id": "clip", "asset_id": "source", "start": 0, "duration": 1,
    }]
    project["export"].update(encoder="software", frame_rate=export_fps)
    output = tmp_path / "export.mp4"
    command, _ = compile_editor_render(
        project, save_root=str(media.parent), workspace="default",
        uploads_root=str(tmp_path), filter_script_path=str(tmp_path / "filters.txt"),
        output_path=str(output),
    )
    subprocess.run(command, check=True, capture_output=True)
    streams = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-count_frames", "-show_streams",
        "-of", "json", str(output),
    ]))["streams"]
    video = next(stream for stream in streams if stream["codec_type"] == "video")
    audio = next(stream for stream in streams if stream["codec_type"] == "audio")
    assert int(video["nb_read_frames"]) == export_fps
    assert float(video["duration"]) == pytest.approx(1, abs=0.001)
    assert float(audio["duration"]) == pytest.approx(1, abs=0.025)
