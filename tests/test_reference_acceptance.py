"""Acceptance must reject wrong timing, unreviewed audio and stale reviews."""
import wave

import pytest

from app.services.reference_acceptance import (
    ARTISTIC_DIMENSIONS, file_hash, run_media, run_media_bytes,
    validate_creative_review, validate_master, validate_pcm,
)


def review(master):
    return {
        'master_sha256': file_hash(master), 'reviewer': 'test reviewer',
        'reviewed_at': '2026-10-19T12:00:00-03:00',
        'scores': {key: 3 for key in ARTISTIC_DIMENSIONS},
        'critical_errors': [], 'speech_correct_and_untruncated': True,
        'title_correct': True,
    }


def test_stale_review_cannot_approve_regenerated_master(tmp_path):
    master = tmp_path / 'master.mp4'
    master.write_bytes(b'take one')
    report = review(master)
    master.write_bytes(b'take two')
    with pytest.raises(ValueError, match='different master'):
        validate_creative_review(master, report)


@pytest.mark.parametrize('change', [
    {'critical_errors': ['wrong_speech']}, {'speech_correct_and_untruncated': False},
    {'title_correct': False}, {'reviewer': ''}, {'scores': {}},
    {'scores': {key: True for key in ARTISTIC_DIMENSIONS}},
])
def test_incomplete_or_failed_review_is_rejected(tmp_path, change):
    master = tmp_path / 'master.mp4'
    master.write_bytes(b'take')
    with pytest.raises(ValueError):
        validate_creative_review(master, {**review(master), **change})


def test_all_artistic_dimensions_must_pass(tmp_path):
    master = tmp_path / 'master.mp4'
    master.write_bytes(b'take')
    validate_creative_review(master, review(master))
    for dimension in ARTISTIC_DIMENSIONS:
        report = review(master)
        report['scores'][dimension] = 2
        with pytest.raises(ValueError, match=dimension):
            validate_creative_review(master, report)


def test_pcm_sample_count_is_exact(tmp_path):
    stem = tmp_path / 'stem.wav'
    with wave.open(str(stem), 'wb') as out:
        out.setparams((2, 2, 48000, 0, 'NONE', 'not compressed'))
        out.writeframes(b'\0' * 48000 * 4)
    validate_pcm(stem, 48000)
    with pytest.raises(ValueError, match='stereo samples'):
        validate_pcm(stem, 48001)


def test_real_ffmpeg_measurement_rejects_wrong_frame_count(tmp_path):
    master = tmp_path / 'master.mp4'
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=160x96:r=24:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '2', '-ar', '48000',
        '-c:v', 'libx264', '-c:a', 'aac', '-t', '1', str(master),
    ])
    expected = {
        'fps': 24, 'total_frames': 24, 'sample_rate': 48000, 'duration_seconds': 1,
        'criteria': {'loudness_lufs': -16, 'loudness_tolerance_lu': 1, 'true_peak_dbtp': -1},
    }
    report = validate_master(master, expected)
    assert report['checks']['frames']
    with pytest.raises(ValueError, match='frames'):
        validate_master(master, {**expected, 'total_frames': 25})


def test_media_bytes_returns_the_raw_samples(tmp_path):
    """The audio measurements need the samples, not a text pipe."""
    tone = tmp_path / 'tone.wav'
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        'sine=frequency=440:sample_rate=48000:duration=1',
        '-ac', '2', '-c:a', 'pcm_s16le', str(tone),
    ])
    raw = run_media_bytes([
        'ffmpeg', '-v', 'error', '-i', str(tone), '-vn',
        '-f', 's16le', '-ac', '2', '-ar', '48000', '-',
    ])
    assert len(raw) == 48000 * 2 * 2
    with wave.open(str(tone), 'rb') as audio:
        assert audio.readframes(audio.getnframes()) == raw


def test_media_bytes_reports_the_failure(tmp_path):
    with pytest.raises(RuntimeError, match='Media command failed'):
        run_media_bytes(['ffmpeg', '-v', 'error', '-i', str(tmp_path / 'missing.wav'), '-'])
