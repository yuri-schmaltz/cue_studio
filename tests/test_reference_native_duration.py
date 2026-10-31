"""Native frames must cover picture time, not just a nominal frame count."""
from pathlib import Path
import shutil
import subprocess

import pytest

from app.services.reference_acceptance import validate_generated_duration


@pytest.mark.parametrize('frames,rate,accepted', [
    (125, 25, True), (121, 25, False), (120, 30, False), (120, 24, True),
])
def test_native_video_covers_a_five_second_24_fps_slot(tmp_path, frames, rate, accepted):
    if not all(shutil.which(tool) for tool in ('ffmpeg', 'ffprobe')):
        pytest.skip('FFmpeg and ffprobe required')
    path = tmp_path / 'native.mp4'
    subprocess.run([
        'ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=size=64x64:rate={rate}',
        '-frames:v', str(frames), '-c:v', 'libx264', str(path),
    ], check=True)
    if accepted:
        result = validate_generated_duration(path, 120, 24)
        assert result['native_seconds'] == 5
        assert result['native_frames'] == frames
    else:
        with pytest.raises(ValueError, match='shorter than the 5.000s edit slot'):
            validate_generated_duration(path, 120, 24)
