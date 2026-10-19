"""Publish a validated video atomically, preserving the last approved artifact."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import subprocess
import tempfile


def validate_video(path: Path) -> None:
    result = subprocess.run([
        os.environ.get('FFPROBE_BINARY', 'ffprobe'), '-v', 'error',
        '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration:format=duration',
        '-of', 'json', str(path),
    ], capture_output=True, text=True, timeout=60, check=True)
    probe = json.loads(result.stdout)
    stream = probe['streams'][0]
    duration = float(stream.get('duration') or probe.get('format', {}).get('duration', 0))
    if int(stream['width']) <= 0 or int(stream['height']) <= 0 or not math.isfinite(duration) or duration <= 0:
        raise ValueError('Encoded video has no valid duration or dimensions')


def publish_video(destination, writer, *, cancelled=None) -> bool:
    """Encode beside the destination; rename only after validation and cancel checks.

    A killed encoder may leave a hidden temporary file. It never overwrites
    the destination or registers that partial file as a completed artifact.
    """
    destination = Path(destination).absolute()
    fd, temporary = tempfile.mkstemp(prefix='.cue-encode-', suffix='.partial' + destination.suffix,
                                     dir=destination.parent)
    os.close(fd)
    temporary = Path(temporary)
    try:
        if cancelled and cancelled():
            return False
        if not writer(str(temporary)):
            return False
        validate_video(temporary)
        if cancelled and cancelled():
            return False
        with temporary.open('rb') as encoded:
            os.fsync(encoded.fileno())
        os.replace(temporary, destination)
        return True
    finally:
        temporary.unlink(missing_ok=True)
