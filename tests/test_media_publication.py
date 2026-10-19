"""Real FFmpeg output, failed encodes and cancellation preserve approved takes."""
from pathlib import Path
import subprocess

import pytest

from app.services.media_publication import publish_video


def encode(path):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'color=s=160x96:r=24:d=0.25', '-c:v', 'libx264', path], check=True)
    return True


def test_success_replaces_only_after_valid_encoding(tmp_path):
    final = tmp_path / 'master.mp4'
    final.write_bytes(b'approved old take')
    def writer(path):
        assert final.read_bytes() == b'approved old take'
        return encode(path)
    assert publish_video(final, writer)
    assert final.read_bytes() != b'approved old take'
    assert not list(tmp_path.glob('.*.partial.mp4'))


def test_partial_encode_does_not_replace_approved_master(tmp_path):
    final = tmp_path / 'master.mp4'
    final.write_bytes(b'approved')
    def writer(path):
        Path(path).write_bytes(b'partial bytes')
        return False
    assert publish_video(final, writer) is False
    assert final.read_bytes() == b'approved'
    assert list(tmp_path.iterdir()) == [final]


def test_invalid_encode_cannot_be_published(tmp_path):
    final = tmp_path / 'master.mp4'
    def writer(path):
        Path(path).write_bytes(b'not a video')
        return True
    with pytest.raises(subprocess.CalledProcessError):
        publish_video(final, writer)
    assert not final.exists()
    assert not list(tmp_path.iterdir())


def test_late_cancel_preserves_previous_take(tmp_path):
    final = tmp_path / 'master.mp4'
    final.write_bytes(b'approved')
    cancelled = False
    def writer(path):
        nonlocal cancelled
        encode(path)
        cancelled = True
        return True
    assert not publish_video(final, writer, cancelled=lambda: cancelled)
    assert final.read_bytes() == b'approved'


def test_killed_encoder_cannot_replace_previous_master(tmp_path):
    import os
    import selectors
    import sys
    final = tmp_path / 'master.mp4'
    final.write_bytes(b'approved previous master')
    code = '''
from pathlib import Path
import sys
from app.services.media_publication import publish_video

def encode(path):
    Path(path).write_bytes(b'partial encoder output')
    print('encoding', flush=True)
    sys.stdin.readline()
    return True
publish_video(sys.argv[1], encode)
'''
    worker = subprocess.Popen([sys.executable, '-u', '-c', code, str(final)],
                              cwd=Path(__file__).resolve().parents[1],
                              env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'),
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(worker.stdout, selectors.EVENT_READ)
            assert selector.select(timeout=20)
        assert worker.stdout.readline().strip() == 'encoding'
        worker.kill()
        worker.wait(timeout=10)
        assert worker.returncode < 0
        assert final.read_bytes() == b'approved previous master'
        assert len(list(tmp_path.glob('.cue-encode-*.partial.mp4'))) == 1
    finally:
        if worker.poll() is None:
            worker.kill()
        worker.communicate(timeout=10)
