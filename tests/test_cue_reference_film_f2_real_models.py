"""Opt-in F2 through real Studio jobs; failures never become synthetic media.

CUE_RUN_REAL_MODELS=1 CUE_F2_CONFIG=/absolute/config.json pytest -m real_models
The configuration selects installed models and voice references using normal
Studio request parameters. A hash-bound review is required for full F2 approval.
See docs/REFERENCE_FILM_VALIDATION.md. Ordinary CI does not run GPU inference.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import wave

import pytest

from app.services.reference_generation import ReferenceGenerationClient
from app.services.reference_acceptance import (
    file_hash, run_media, validate_creative_review, validate_master, validate_pcm,
)

pytestmark = pytest.mark.real_models
FIXTURE = Path(__file__).parent / 'fixtures/cue_reference_film_v1'
EXPECTED = json.loads((FIXTURE / 'expected.json').read_text())
SPEECH = json.loads((FIXTURE / 'speech.json').read_text())
SHOTS = json.loads((FIXTURE / 'shots.json').read_text())['shots']
SOUND = json.loads((FIXTURE / 'sound_cues.json').read_text())
VISUAL = json.loads((FIXTURE / 'visual_prompts.json').read_text())


@pytest.fixture(scope='module')
def config():
    if os.environ.get('CUE_RUN_REAL_MODELS') != '1':
        pytest.skip('Real-model inference is opt-in: set CUE_RUN_REAL_MODELS=1')
    path = os.environ.get('CUE_F2_CONFIG')
    assert path, 'CUE_F2_CONFIG must select installed real models and a persistent output directory'
    cfg = json.loads(Path(path).read_text())
    for key in ('speech', 'music', 'image', 'video', 'sfx'):
        assert cfg[key].get('model_type'), f'Missing real model for {key}'
    return cfg


def _normalize_audio(source, target, samples=None):
    filters = ['aresample=48000']
    if samples is not None:
        filters += ['apad', f'atrim=end_sample={samples}']
    run_media(['ffmpeg', '-y', '-v', 'error', '-i', str(source), '-af', ','.join(filters),
               '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(target)])


def _place_audio(source, dest, start, gain=1, loop=False):
    # Source speech is checked against its cue before this function. Only
    # silence outside the generated segment is padded or trimmed here.
    run_media(['ffmpeg', '-y', '-v', 'error', *(['-stream_loop', '-1'] if loop else []), '-i', str(source), '-vn', '-af',
               f'volume={gain},adelay={round(start * 48000)}S:all=1,apad,atrim=end_sample=2880000',
               '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(dest)])
    validate_pcm(dest, EXPECTED['audio_samples_per_channel'])


def test_f2_generate_and_measure_real_jobs(config):
    output = Path(config['validation_dir']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    client = ReferenceGenerationClient(config['base_url'], Path(config['server_output_dir']), output / 'receipts',
                                       token=os.environ.get('CUE_F2_TOKEN', ''), timeout=config.get('job_timeout', 3600))
    stems, clips = [], []
    for cue in SPEECH['cues']:
        raw = client.generate(cue['id'], {**config['speech'], 'prompt': cue['text']}, {'.wav', '.flac'})
        normalized = output / (cue['id'] + '-raw.wav')
        _normalize_audio(raw, normalized)
        with wave.open(str(normalized), 'rb') as audio:
            assert audio.getnframes() <= round((cue['end_seconds'] - cue['start_seconds']) * 48000), 'Generated speech exceeds cue; regenerate it rather than truncate words'
        stem = output / (cue['id'] + '.wav')
        _place_audio(normalized, stem, cue['start_seconds'])
        stems.append(stem)
    raw = client.generate('music', {**config['music'], 'duration_seconds': 60}, {'.wav', '.flac'})
    music = output / 'music.wav'
    _normalize_audio(raw, music, EXPECTED['audio_samples_per_channel'])
    validate_pcm(music, EXPECTED['audio_samples_per_channel'])
    stems.append(music)
    # Keep each model resident for its batch; alternating image/video would
    # reload both checkpoints for every shot on a constrained GPU.
    assert config.get('image_supports_references') is True, 'Choose an image model supporting canonical visual references'
    image_params = {**config['image'], 'generation_mode': 'image', 'image_mode': 1, 'video_length': 1}
    anchors = {}
    for kind in ('character', 'location'):
        anchors[kind] = client.generate('anchor-' + kind,
            {**image_params, 'prompt': VISUAL['style'] + ' ' + VISUAL[kind]}, {'.png', '.jpg', '.jpeg', '.webp'})
    references = {}
    for shot in SHOTS:
        guides = [anchors['location']]
        if shot['characters']:
            guides.insert(0, anchors['character'])
        references[shot['id']] = client.generate(shot['id'] + '-image', {
            **image_params, 'prompt': VISUAL['style'] + ' ' + VISUAL['shots'][shot['id']]['image'],
            'image_refs': [str(path) for path in guides], 'video_prompt_type': 'KI',
        }, {'.png', '.jpg', '.jpeg', '.webp'})
    for shot in SHOTS:
        video = client.generate(shot['id'] + '-video', {
            **config['video'], 'prompt': VISUAL['style'] + ' ' + VISUAL['shots'][shot['id']]['motion'], 'image_start': str(references[shot['id']]), 'image_prompt_type': 'S',
        }, {'.mp4', '.mkv', '.webm'})
        clip = output / (shot['id'] + '.mp4')
        # Conform generated media to the edit's 120-frame delivery slots.
        run_media(['ffmpeg', '-y', '-v', 'error', '-i', str(video), '-an', '-vf',
                   'fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                   '-frames:v', str(shot['duration_frames']), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(clip)])
        clips.append(clip)
    for effect in SOUND['effects']:
        shot_index = next((i for i, s in enumerate(SHOTS) if s['id'] == effect['shot']), 0)
        raw = client.generate(effect['id'], {**config['sfx'], 'prompt': effect['type'],
                                              'video_guide': str(clips[shot_index])}, {'.wav', '.flac', '.mp4'})
        stem = output / (effect['id'] + '.wav')
        _place_audio(raw, stem, effect['start_seconds'], effect['gain'], effect.get('loop', False))
        stems.append(stem)
    inputs = [arg for path in stems for arg in ('-i', str(path))]
    mixed = output / 'mix.wav'
    run_media(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex',
               f'amix=inputs={len(stems)}:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11',
               '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(mixed)])
    title = output / 'title.txt'
    title.write_text(SOUND['title_cue']['text'])
    concat = output / 'concat.txt'
    concat.write_text(''.join("file '" + str(p).replace("'", "'\\''") + "'\n" for p in clips))
    partial = output / 'master.partial.mp4'
    master = output / 'master.mp4'
    run_media(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(concat), '-i', str(mixed),
               '-vf', f"drawtext=textfile='{title}':fontcolor=white:fontsize=48:x=(w-tw)/2:y=h*0.8:enable='gte(t,55)'",
               '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
               '-frames:v', '1440', '-t', '60', str(partial)])
    report = validate_master(partial, EXPECTED)
    partial.replace(master)
    (output / 'technical-report.json').write_text(json.dumps(report, indent=2))
    assert file_hash(master) == report['master_sha256']


def test_f2_full_acceptance_requires_creative_review(config):
    output = Path(config['validation_dir']).resolve()
    master = output / 'master.mp4'
    assert master.is_file(), 'Generate and measure the real master first'
    validate_master(master, EXPECTED)
    review_path = output / 'creative-review.json'
    assert review_path.is_file(), 'Full F2 remains unverified until the actual master is reviewed'
    validate_creative_review(master, json.loads(review_path.read_text()))
