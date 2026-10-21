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
from app.services.reference_mix import (
    MIN_SPEECH_MARGIN_DB, Stem, level_stems, mix_stems, narration_margin_db,
)
from app.services import reference_continuity, reference_robot
from app.services.reference_identity import EXPECTED_LENSES, analyse, check_anchor_lenses
from app.services.reference_cube import check_cube_continuity, check_cube_count
from app.services.reference_robot import check_scale_stability
from app.services.reference_continuity import check_relative_scale, check_scale_consistency
from app.services import reference_ground

pytestmark = pytest.mark.real_models
FIXTURE = Path(__file__).parent / 'fixtures/cue_reference_film_v1'
EXPECTED = json.loads((FIXTURE / 'expected.json').read_text())
SPEECH = json.loads((FIXTURE / 'speech.json').read_text())
SHOTS = json.loads((FIXTURE / 'shots.json').read_text())['shots']
SOUND = json.loads((FIXTURE / 'sound_cues.json').read_text())
VISUAL = json.loads((FIXTURE / 'visual_prompts.json').read_text())

# The cube is the film's continuity object and must exist exactly once in
# every shot that shows it. The creative review of the rejected v6 master
# rejected the film because one shot held two cubes, so the count is a
# hard gate and not a remark.
#
# S10 is the close-up of the robot's head: the script keeps the cube out
# of the frame there, so a cube that shows up in it is a defect.
CUBE_EXPECTED = {shot['id']: (0 if shot['id'] == 'S10' else 1) for shot in SHOTS}
# The shots where the framing keeps the cube out of sight are measured as
# evidence instead of a hard gate: the cube sits inside the socket of the
# pedestal in S09 and the robot's hand covers it in S05.
CUBE_EXPECTATION = {
    'S01': 'required', 'S02': 'required', 'S03': 'required', 'S04': 'required',
    'S05': 'evidence', 'S06': 'required', 'S07': 'required', 'S08': 'required',
    'S09': 'evidence', 'S10': 'absent', 'S11': 'required', 'S12': 'required',
}
# The head of the robot has to keep one size inside a shot. The wide and
# medium shots are the measurable ones: in a close-up the head fills the
# frame and its measured width follows the camera, not the robot.
ROBOT_SCALE_SHOTS = {'S02', 'S04', 'S06', 'S07', 'S11'}
# The robot holds the cube in its right hand in these shots, so the head
# width over the cube width is a ruler that survives the change of shot
# size. In the other shots the cube is on the table or in the socket, at
# another distance from the camera, and the ratio would measure the
# camera instead of the robot.
ROBOT_SCALE_WITH_CUBE = {'S04', 'S05', 'S06', 'S07', 'S08'}
# The shots where the ruler is measured across the film to check that the
# robot keeps one size along the whole movie. These are the shots in
# which the robot holds the cube and its head is measurable at the same
# time: only there do the head and the cube sit at the same distance
# from the camera, which is what makes the ratio comparable between
# shots. The creative review of the rejected v6 master rejected the film
# for a robot of different sizes along the video, and this is the
# measurement that catches it.
ROBOT_SCALE_FILM_SHOTS = {'S04', 'S06', 'S07'}


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
    # The resample must come first: MMAudio renders at 44100 Hz, and
    # trimming/padding to 2880000 samples before resampling would cut the
    # 60 s timeline at the wrong rate (and shift the cue offset by the
    # same ratio), producing a stem whose length and cue positions are
    # both wrong.
    run_media(['ffmpeg', '-y', '-v', 'error', *(['-stream_loop', '-1'] if loop else []), '-i', str(source), '-vn', '-af',
               f'aresample=48000,volume={gain},adelay={round(start * 48000)}S:all=1,apad,atrim=end_sample=2880000',
               '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(dest)])
    validate_pcm(dest, EXPECTED['audio_samples_per_channel'])


def _release_models(client):
    """Give the GPU memory back before the next model loads.

    The Studio keeps the model of a job resident between jobs on purpose,
    so a retry with the same model skips the load. The video model does
    not fit in the GPU next to the image model, and the release endpoint
    is the documented way to give the memory back: the Studio reloads
    the model transparently on the next job.
    """
    client.request('/api/v1/system/release-model', {})


def _generate(client, output: Path, label: str, params: dict, extensions: set[str]) -> Path:
    """Run a job, repeating it when the previous attempt failed.

    A failed job leaves no artifact, so its receipt protects no
    evidence: removing it lets the work be done again instead of
    replaying a job that already failed. A receipt of a completed job
    is never touched, and neither is the artifact it points to.
    """
    receipt = output / 'receipts' / (label + '.json')
    if receipt.is_file():
        previous = json.loads(receipt.read_text())
        if previous.get('status') in {'failed', 'cancelled'}:
            receipt.unlink()
    return client.generate(label, params, extensions)


def _collect(failures: list[str], label: str, check, *args, **kwargs):
    """Run a gate, record its failure instead of aborting the run.

    Every gate of the film is measured in one pass, so a single run
    reports every defect of the film instead of only the first one. The
    failures are still fatal: they are raised together at the end of the
    measurement.
    """
    try:
        return check(*args, **kwargs)
    except ValueError as error:
        failures.append(f'{label}: {error}')
        return {'verdict': 'failed', 'error': str(error)}


def test_f2_generate_and_measure_real_jobs(config):
    output = Path(config['validation_dir']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    client = ReferenceGenerationClient(config['base_url'], Path(config['server_output_dir']), output / 'receipts',
                                       token=os.environ.get('CUE_F2_TOKEN', ''), timeout=config.get('job_timeout', 3600))
    stems, clips = [], []
    for cue in SPEECH['cues']:
        raw = _generate(client, output, cue['id'], {**config['speech'], 'prompt': cue['text']}, {'.wav', '.flac'})
        normalized = output / (cue['id'] + '-raw.wav')
        _normalize_audio(raw, normalized)
        with wave.open(str(normalized), 'rb') as audio:
            assert audio.getnframes() <= round((cue['end_seconds'] - cue['start_seconds']) * 48000), 'Generated speech exceeds cue; regenerate it rather than truncate words'
        stem = output / (cue['id'] + '.wav')
        _place_audio(normalized, stem, cue['start_seconds'])
        stems.append(Stem(stem, 'speech'))
    raw = _generate(client, output, 'music', {**config['music'], 'duration_seconds': 60}, {'.wav', '.flac'})
    music = output / 'music.wav'
    _normalize_audio(raw, music, EXPECTED['audio_samples_per_channel'])
    validate_pcm(music, EXPECTED['audio_samples_per_channel'])
    stems.append(Stem(music, 'music'))
    # Keep each model resident for its batch; alternating image/video would
    # reload both checkpoints for every shot on a constrained GPU.
    assert config.get('image_supports_references') is True, 'Choose an image model supporting canonical visual references'
    # The negative prompt is part of the film's recipe, not of the machine
    # that renders it, so it lives with the prompts in the fixture and is
    # attached here. The rejected v6 master left the image block without a
    # negative prompt, and the consequences were measured: the model
    # rendered a second red cube and a fourth lens. A negative prompt only
    # takes effect in Flux2 when NAG is enabled together with a guidance
    # scale of at most 1, so both are required and both are checked.
    image_params = {
        **config['image'],
        'negative_prompt': VISUAL['negative']['image'],
        'generation_mode': 'image',
        'image_mode': 1,
        'video_length': 1,
    }
    assert float(image_params.get('NAG_scale', 1)) > 1, (
        'The image negative prompt is only honoured by Flux2 when NAG_scale is above 1; '
        'without it the model ignores the negative prompt entirely.')
    assert float(image_params.get('guidance_scale', 1)) <= 1, (
        'Flux2 applies the negative prompt through NAG only while guidance_scale is at '
        'most 1; a higher guidance scale disables it.')
    video_params = {**config['video'], 'negative_prompt': VISUAL['negative']['video']}
    anchors = {}
    for kind in ('character', 'location'):
        params = {**image_params, 'prompt': VISUAL['style'] + ' ' + VISUAL[kind]}
        if kind == 'character':
            # The character anchor is the film's identity and every shot
            # inherits it, so it gets its own measured seed instead of the
            # generic one: the canonical prompt alone does not pin the
            # lens count, and a wrong anchor would repeat the defect.
            params['seed'] = config.get('character_anchor_seed', 99)
        anchors[kind] = _generate(client, output, 'anchor-' + kind, params, {'.png', '.jpg', '.jpeg', '.webp'})
    # Fail before rendering the expensive shots: an anchor with the wrong
    # lens count makes the whole film wrong.
    lens_evidence = {'anchor-character': check_anchor_lenses(anchors['character'])}
    # Every still is rendered before any of them is measured. The
    # measurement is what decides whether the film is accepted, and the
    # render is the expensive part: measuring as the film is rendered
    # would throw away the shots that were never reached because an
    # earlier one failed.
    references = {}
    for shot in SHOTS:
        guides = [anchors['location']]
        if shot['characters']:
            guides.insert(0, anchors['character'])
        references[shot['id']] = _generate(client, output, shot['id'] + '-image', {
            **image_params, 'prompt': VISUAL['style'] + ' ' + VISUAL['shots'][shot['id']]['image'],
            'image_refs': [str(path) for path in guides], 'video_prompt_type': 'KI',
        }, {'.png', '.jpg', '.jpeg', '.webp'})
    # The measurements of the film. Every gate is evaluated before any of
    # them is reported, so one run tells the whole story of the film.
    failures: list[str] = []
    cube_evidence = {}
    for shot in SHOTS:
        lens_evidence[shot['id'] + '-image'] = analyse(references[shot['id']])
        # The cube count is measured on the still that the shot starts
        # from: it is the frame the reviewer sees first and the one the
        # video is anchored to.
        cube_evidence[shot['id'] + '-image'] = _collect(
            failures, shot['id'] + '-image', check_cube_count,
            references[shot['id']], expected=CUBE_EXPECTED[shot['id']])
    # S03 is the neutral-light close-up, so its lens count is measurable and
    # is part of acceptance. Every other shot is recorded as evidence: under
    # amber light the lenses lose saturation and the detector miscounts.
    s03_image = lens_evidence['S03-image']
    if s03_image['distribution'].get(EXPECTED_LENSES) != s03_image['frames']:
        failures.append(
            f"S03 close-up must show exactly {EXPECTED_LENSES} lenses: {s03_image['distribution']}")
    # S10 is the amber-lit close-up that shipped the four-lens defect: the
    # lenses stay saturated there, so the count is measurable and the
    # identity fix is guarded instead of merely recorded.
    s10_image = lens_evidence['S10-image']
    if s10_image['distribution'].get(EXPECTED_LENSES) != s10_image['frames']:
        failures.append(
            f"S10 close-up must show exactly {EXPECTED_LENSES} lenses: {s10_image['distribution']}")
    # The video model does not fit in the GPU next to the image model,
    # so the memory is given back before the batch of clips starts.
    _release_models(client)
    for shot in SHOTS:
        video = _generate(client, output, shot['id'] + '-video', {
            **video_params, 'prompt': VISUAL['style'] + ' ' + VISUAL['shots'][shot['id']]['motion'], 'image_start': str(references[shot['id']]), 'image_prompt_type': 'S',
        }, {'.mp4', '.mkv', '.webm'})
        clip = output / (shot['id'] + '.mp4')
        # Conform generated media to the edit's 120-frame delivery slots.
        run_media(['ffmpeg', '-y', '-v', 'error', '-i', str(video), '-an', '-vf',
                   'fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                   '-frames:v', str(shot['duration_frames']), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(clip)])
        clips.append(clip)
    scale_evidence = {}
    relative_evidence = {}
    ground_evidence = {}
    film_measurements = {}
    for shot in SHOTS:
        clip = clips[next(i for i, s in enumerate(SHOTS) if s['id'] == shot['id'])]
        lens_evidence[shot['id'] + '-video'] = analyse(clip)
        # A second cube is a defect in every shot, whatever the script
        # says: the rejected master showed two cubes in almost half of the
        # frames of S06 and the human review rejected the film for it.
        cube_evidence[shot['id'] + '-video'] = _collect(
            failures, shot['id'] + '-video', check_cube_continuity,
            clip, expectation=CUBE_EXPECTATION[shot['id']])
        # The robot keeps one size inside a shot. The measurement is
        # reported for every shot and claimed only where the framing
        # allows it: in a close-up the head fills the frame and its width
        # follows the camera.
        if shot['id'] in ROBOT_SCALE_SHOTS:
            scale_evidence[shot['id'] + '-video'] = _collect(
                failures, shot['id'] + '-video', check_scale_stability, clip)
        else:
            scale_evidence[shot['id'] + '-video'] = reference_robot.analyse(clip)
        # The relative size of the robot is measured against the cube it
        # holds, the only ruler that survives a change of shot size.
        if shot['id'] in ROBOT_SCALE_WITH_CUBE:
            relative_evidence[shot['id'] + '-video'] = _collect(
                failures, shot['id'] + '-video', check_relative_scale, clip)
            film_measurements[shot['id']] = relative_evidence[shot['id'] + '-video']
        else:
            relative_evidence[shot['id'] + '-video'] = reference_continuity.analyse(clip)
        # How high the robot stands above its own shadow. This is
        # evidence and never a gate: the render only casts a shadow
        # under the robot in some of the shots, and the creative review
        # is what accepts the film.
        ground_evidence[shot['id'] + '-video'] = reference_ground.analyse(clip)
    # The robot keeps one size along the whole film, not only inside a
    # shot. The creative review of the rejected v6 master rejected the
    # film for a robot of different sizes along the video, and this is
    # the measurement that catches it.
    consistency = _collect(failures, 'film', check_scale_consistency, film_measurements)
    # The measurements are written before the sound is generated: the
    # sound needs the GPU, and a film whose shots were rejected does not
    # deserve one. The evidence stays on disk either way, so a rejected
    # film can be measured and calibrated without rendering it again.
    (output / 'shot-evidence.json').write_text(json.dumps({
        'lens_evidence': lens_evidence,
        'cube_evidence': cube_evidence,
        'scale_evidence': scale_evidence,
        'relative_evidence': relative_evidence,
        'ground_evidence': ground_evidence,
        'scale_consistency': consistency,
        'failures': failures,
    }, indent=2))
    assert not failures, 'The film was rejected by its own measurements:\n' + '\n'.join(
        f'  - {failure}' for failure in failures)
    # The sound effects use a third model, and it does not fit in the GPU
    # next to the video model either.
    _release_models(client)
    for effect in SOUND['effects']:
        shot_index = next((i for i, s in enumerate(SHOTS) if s['id'] == effect['shot']), 0)
        raw = _generate(client, output, effect['id'], {**config['sfx'], 'prompt': effect['type'],
                                                       'video_guide': str(clips[shot_index])}, {'.wav', '.flac', '.mp4'})
        stem = output / (effect['id'] + '.wav')
        _place_audio(raw, stem, effect['start_seconds'], effect['gain'], effect.get('loop', False))
        # The ambient bed is a room tone under everything; the other effects
        # are transients, whose authored gain is their relative weight.
        kind = 'ambient' if effect['type'] == 'ambient' else 'effect'
        stems.append(Stem(stem, kind, effect['gain']))
    mixed = output / 'mix.wav'
    # Every stem is levelled against its own role anchor before the mix, so
    # the narration stays above the bed instead of being buried by a music
    # generator that happens to run far louder than the voice.
    leveled = level_stems(stems, output / 'leveled')
    report = mix_stems(leveled, mixed, samples=EXPECTED['audio_samples_per_channel'])
    validate_pcm(mixed, EXPECTED['audio_samples_per_channel'])
    # The programme must also be audible: each narration cue has to measure
    # above the bed, not merely exist in the timeline.
    bed_window = (25.0, 8.0)
    for cue in SPEECH['cues']:
        margin = narration_margin_db(mixed, (cue['start_seconds'], cue['end_seconds'] - cue['start_seconds']), bed_window)
        assert margin >= MIN_SPEECH_MARGIN_DB, f"{cue['id']}: narration is masked by the bed by {margin:.2f} dB"
    title = output / 'title.txt'
    title.write_text(SOUND['title_cue']['text'])
    concat = output / 'concat.txt'
    concat.write_text(''.join("file '" + str(p).replace("'", "'\\''") + "'\n" for p in clips))
    partial = output / 'master.partial.mp4'
    master = output / 'master.mp4'
    # The limiter keeps the encoded peak under the acceptance ceiling
    # without altering the integrated loudness.
    run_media(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(concat), '-i', str(mixed),
               '-af', 'alimiter=limit=0.891251:attack=1:release=20:level=disabled',
               '-vf', f"drawtext=textfile='{title}':fontcolor=white:fontsize=48:x=(w-tw)/2:y=h*0.8:enable='gte(t,55)'",
               '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
               '-frames:v', '1440', '-t', '60', str(partial)])
    report = validate_master(partial, EXPECTED)
    # The lens metric is evidence for the reviewer: which shots were measured
    # under neutral light (where the count is reliable) and which were only
    # recorded because amber light makes the detector unreliable.
    report['lens_evidence'] = lens_evidence
    # The same for the cube and the size of the robot: the measurements
    # that decided the acceptance of the film, kept with the film.
    report['cube_evidence'] = cube_evidence
    report['scale_evidence'] = scale_evidence
    report['relative_evidence'] = relative_evidence
    report['ground_evidence'] = ground_evidence
    report['scale_consistency'] = consistency
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
