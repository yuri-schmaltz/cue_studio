"""Measured technical acceptance and hash-bound creative review for F2."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess
import wave

ARTISTIC_DIMENSIONS = (
    "identity", "continuity", "motion", "appearance", "pt_br_voice", "sound_editing",
)


def run_media(args: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(args, capture_output=True, text=True, timeout=600)
    if result.returncode:
        raise RuntimeError(f"Media command failed: {args[0]}\n{result.stderr[-4000:]}")
    return result


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_pcm(path: Path, samples: int, sample_rate: int = 48000) -> None:
    with wave.open(str(path), 'rb') as audio:
        if (audio.getframerate(), audio.getnchannels(), audio.getnframes()) != (sample_rate, 2, samples):
            raise ValueError(f"{path.name}: stem must contain {samples} stereo samples at {sample_rate} Hz")


def validate_master(path: Path, expected: dict) -> dict:
    probe = json.loads(run_media([
        'ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(path),
    ]).stdout)
    video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    num, den = map(int, video['r_frame_rate'].split('/'))
    fps = expected['fps']
    checks = {
        'frames': int(video['nb_frames']) == expected['total_frames'],
        'fps': num / den == fps,
        'sample_rate': int(audio['sample_rate']) == expected['sample_rate'],
        'channels': int(audio['channels']) == 2,
        'av_drift': abs(float(video['duration']) - float(audio['duration'])) <= 1 / fps,
        'audio_duration': abs(float(audio['duration']) - expected['duration_seconds']) <= 1 / fps,
    }
    measured = run_media([
        'ffmpeg', '-hide_banner', '-i', str(path), '-vn',
        '-af', 'loudnorm=I=-16:TP=-1:LRA=11:print_format=json', '-f', 'null', '-',
    ]).stderr
    loudness = json.loads(measured[measured.rfind('{'):])
    integrated = float(loudness['input_i'])
    peak = float(loudness['input_tp'])
    criteria = expected['criteria']
    checks['loudness'] = math.isfinite(integrated) and abs(integrated - criteria['loudness_lufs']) <= criteria['loudness_tolerance_lu']
    checks['true_peak'] = math.isfinite(peak) and peak <= criteria['true_peak_dbtp']
    if not all(checks.values()):
        raise ValueError(f"F2 technical acceptance failed: {checks}; LUFS={integrated}, dBTP={peak}")
    return {'checks': checks, 'loudness_lufs': integrated, 'true_peak_dbtp': peak, 'master_sha256': file_hash(path)}


def validate_creative_review(master: Path, review: dict) -> None:
    """Creative quality cannot be inferred from container metadata or a test name."""
    if review.get('master_sha256') != file_hash(master):
        raise ValueError('Creative review belongs to a different master')
    if not review.get('reviewer') or not review.get('reviewed_at'):
        raise ValueError('Creative review requires reviewer and reviewed_at')
    scores = review.get('scores', {})
    for dimension in ARTISTIC_DIMENSIONS:
        score = scores.get(dimension)
        if type(score) is not int or not 3 <= score <= 4:
            raise ValueError(f'Creative review failed or missing: {dimension}')
    if review.get('critical_errors') != []:
        raise ValueError('Creative review must explicitly report no critical errors')
    if review.get('speech_correct_and_untruncated') is not True:
        raise ValueError('PT-BR speech correctness and word endings have not been reviewed')
    if review.get('title_correct') is not True:
        raise ValueError('Title has not been reviewed')
