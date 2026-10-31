"""Live requests must keep their window through queue parameter migration."""
import asyncio

import pytest


@pytest.mark.parametrize('declared_version', [None, 2.52])
def test_live_window_survives_real_queue_preparation(declared_version):
    launch = pytest.importorskip('launch')
    body = {
        'model_type': 'ltx2_22B_distilled_1_1',
        'prompt': 'Fixed camera, quiet workshop.',
        'video_length': 137, 'sliding_window_size': 137,
        'num_inference_steps': 8, 'image_prompt_type': '',
        'generation_mode': 'video', 'resolution': '1280x720',
    }
    if declared_version is not None:
        body['settings_version'] = declared_version
    original = dict(body)
    prepared = asyncio.run(launch._prepare_generation_submission(body, prepare_only=True))['params']
    assert prepared['settings_version'] == (declared_version or launch.wgp.settings_version)
    window = prepared['sliding_window_size']
    assert window >= body['video_length']
    _, error = launch.wgp._process_task_params(prepared, {})
    assert error is None
    assert prepared['sliding_window_size'] == window
    assert body == original


def test_unversioned_saved_queue_still_uses_legacy_migration():
    launch = pytest.importorskip('launch')
    params = {'model_type': 'ltx2_22B_distilled_1_1', 'sliding_window_size': 137, 'video_length': 137}
    _, error = launch.wgp._process_task_params(params, {})
    assert error is None
    assert 'sliding_window_size' not in params
