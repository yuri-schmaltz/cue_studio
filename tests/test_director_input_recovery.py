"""Removed references reject resume before model validation or worker dispatch."""
import json
import pytest
from app.services.director_inputs import validate_director_inputs


@pytest.mark.parametrize('field,value', [
    ('reference_image_path', 'removed.png'),
    ('voice_reference', 'removed.wav'),
    ('character_ref_paths', ['removed.png']),
    ('location_ref_paths', ['removed.png']),
    ('minimax_h3_references', [{'type': 'audio', 'path': 'removed.wav'}]),
])
def test_removed_reference_is_rejected(tmp_path, field, value, monkeypatch):
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValueError, match='Missing Director input'):
        validate_director_inputs({field: value})


def test_owned_reference_survives_removal_of_original(tmp_path):
    source = tmp_path / 'upload.png'
    owned = tmp_path / 'owned.png'
    source.write_bytes(b'image')
    owned.write_bytes(source.read_bytes())
    source.unlink()
    validate_director_inputs({'reference_image_path': str(owned)})


def test_resume_blocks_missing_reference_before_gpu_dispatch(tmp_path, monkeypatch):
    from services import director_pipeline as pipeline
    state = tmp_path / 'saved.json'
    state.write_text(json.dumps({'_params_snapshot': {'reference_image_path': str(tmp_path / 'removed.png')}}))
    monkeypatch.setattr(pipeline, '_find_pipeline_state_file', lambda *a: str(state))
    monkeypatch.setattr(pipeline, '_repair_saved_h3_frame_lattice', lambda data: False)
    def forbidden(*args, **kwargs):
        pytest.fail('GPU/model validation or worker dispatch ran with a missing input')
    monkeypatch.setattr(pipeline, '_validate_director_models', forbidden)
    monkeypatch.setattr(pipeline, '_start_pipeline_worker', forbidden)
    ok, message = pipeline._resume_pipeline_reserved('missing-ref', str(tmp_path))
    assert not ok
    assert 'Missing Director input' in message
