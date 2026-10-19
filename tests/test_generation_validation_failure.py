"""A rejected task must fail its real worker, including deferred jobs."""
from pathlib import Path

import pytest


@pytest.mark.parametrize('finalize', [True, False])
@pytest.mark.parametrize('outcome', ['rejected', 'empty'])
def test_unsuccessful_task_cannot_complete_job(tmp_path, monkeypatch, finalize, outcome):
    import launch
    runtime = launch.wgp
    job_id = 'rejected-task'
    job = {'id': job_id, 'status': 'queued', 'params': {
        'model_type': 'validation-fixture', 'prompt': 'invalid template {unknown}',
        'generation_mode': 'image',
    }, 'out_dir': str(tmp_path)}
    monkeypatch.setattr(launch, '_jobs', {job_id: job})
    monkeypatch.setattr(launch, '_apply_per_job_coefficient', lambda job: None)
    monkeypatch.setattr(launch, '_restore_base_coefficient', lambda: None)
    monkeypatch.setattr(launch, '_apply_deferred_generation_preparation', lambda job: None)
    monkeypatch.setattr(launch, '_apply_deferred_prompt_enhancement', lambda *a: None)
    monkeypatch.setattr(launch, '_ensure_managed_loras_present', lambda *a, **kw: None)
    monkeypatch.setattr(launch, '_workspace_dir', lambda: str(tmp_path))
    monkeypatch.setattr(runtime, 'get_model_def', lambda *a: {})
    monkeypatch.setattr(runtime, '_parse_task_manifest', lambda manifest, *a: ([
        {'params': entry['params'], 'prompt': entry['params']['prompt']}
        for entry in manifest
    ], None))
    monkeypatch.setattr(runtime, 'get_gen_info', lambda state: state['gen'])
    monkeypatch.setattr(runtime, 'validate_task', lambda task, state: None if outcome == 'rejected' else task['params'])
    def generate_video(*args, **kwargs):
        if outcome == 'rejected':
            pytest.fail('Rejected input reached inference')
        # An engine returning without media is not successful inference.
    monkeypatch.setattr(runtime, 'generate_video', generate_video)
    from shared.utils import thread_utils
    monkeypatch.setattr(thread_utils, 'async_run', lambda function: function())
    assert launch._run_generation(job_id, finalize=finalize) is False
    assert job['status'] == 'failed'
    assert ('validation failed' if outcome == 'rejected' else 'no media artifacts') in job['error'].lower()
    assert not job.get('output_files')
    assert not list(Path(tmp_path).glob('*.mp4'))


@pytest.mark.parametrize('kind', ['missing', 'corrupt'])
def test_sfx_invalid_guide_never_falls_back_to_text_only(tmp_path, monkeypatch, kind):
    import launch
    import time
    guide = tmp_path / 'guide.mp4'
    if kind == 'corrupt':
        guide.write_bytes(b'broken video')
        from types import SimpleNamespace
        import sys
        def broken_reader(path):
            raise ValueError('Cannot decode guide')
        monkeypatch.setitem(sys.modules, 'decord', SimpleNamespace(VideoReader=broken_reader))
    monkeypatch.setattr(launch.wgp, 'get_mmaudio_settings', lambda *a, **kw: pytest.fail('Invalid guide reached model loading'))
    job = {'job_id': 'sfx-invalid', 'status': 'running', 'out_dir': str(tmp_path), 'params': {}}
    assert launch._run_sfx_generation(job, {'video_guide': str(guide)}, time.time()) is False
    assert job['status'] == 'failed'
    assert 'video_guide' in job['error']
    assert not job.get('output_files')


@pytest.mark.parametrize('produces_file', [True, False])
def test_sfx_claims_only_its_own_output(tmp_path, monkeypatch, produces_file):
    import launch
    import sys
    import time
    from types import SimpleNamespace
    output = tmp_path / 'owned.wav'
    foreign = tmp_path / 'foreign.wav'
    monkeypatch.setattr(launch.wgp, 'get_mmaudio_settings', lambda *a, **kw: (True, None, 'off', 'test', 'test'))
    monkeypatch.setattr(launch.wgp, 'download_mmaudio', lambda **kw: None)
    monkeypatch.setattr(launch.wgp, 'get_available_filename', lambda *a, **kw: str(output))
    def model_call(**kwargs):
        foreign.write_bytes(b'written by another producer')
        if produces_file:
            output.write_bytes(b'owned artifact')
    monkeypatch.setitem(sys.modules, 'postprocessing.mmaudio.mmaudio', SimpleNamespace(video_to_audio=model_call))
    job = {'job_id': 'sfx-owner', 'status': 'running', 'out_dir': str(tmp_path), 'params': {}}
    result = launch._run_sfx_generation(job, {'prompt': 'workshop', '_mmaudio_variant': 'v2'}, time.time())
    assert result is produces_file
    assert job['status'] == ('completed' if produces_file else 'failed')
    assert job.get('output_files', []) == (['owned.wav'] if produces_file else [])
    assert foreign.is_file()
