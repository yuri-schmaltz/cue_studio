from pathlib import Path
import json

import pytest

from app.services.reference_recipe import end_frame_request, end_frame_source, load_visual_recipe, video_request


def test_recipe_snapshot_cannot_be_replaced_on_resume(tmp_path):
    source = tmp_path / 'source.json'
    snapshot = tmp_path / 'film' / 'visual-recipe.json'
    recipe = {'style': 'Style.', 'shots': {'S09': {'image': 'Off.', 'motion': 'Light up.'}}}
    source.write_text(json.dumps(recipe))
    assert load_visual_recipe(source, snapshot, ['S09']) == recipe
    original = snapshot.read_bytes()
    assert load_visual_recipe(source, snapshot, ['S09']) == recipe
    recipe['shots']['S09']['motion'] = 'Different action.'
    source.write_text(json.dumps(recipe))
    with pytest.raises(ValueError, match='new validation directory'):
        load_visual_recipe(source, snapshot, ['S09'])
    assert snapshot.read_bytes() == original


def test_incomplete_or_ambiguous_recipe_is_rejected_before_snapshot(tmp_path):
    source = tmp_path / 'source.json'
    snapshot = tmp_path / 'snapshot.json'
    recipe = {'style': 'Style.', 'shots': {'S09': {'image': 'Off.', 'motion': 'Light up.'}}}
    source.write_text(json.dumps(recipe))
    with pytest.raises(ValueError, match='exactly the reference-film shots'):
        load_visual_recipe(source, snapshot, ['S01', 'S09'])
    assert not snapshot.exists()
    recipe['shots']['S09'].update(end_image='Light on.', end_image_source='start')
    source.write_text(json.dumps(recipe))
    with pytest.raises(ValueError, match='not both'):
        load_visual_recipe(source, snapshot, ['S09'])
    assert not snapshot.exists()


def test_end_source_distinguishes_no_endpoint_real_start_and_generated_edit():
    assert end_frame_source({}) is None
    assert end_frame_source({'end_image_source': 'start'}) == 'start'
    assert end_frame_source({'end_image': 'Raise only the right hand.'}) == 'generated'
    with pytest.raises(ValueError, match='not both'):
        end_frame_source({'end_image_source': 'start', 'end_image': 'Move.'})
    with pytest.raises(ValueError, match='end_image_source'):
        end_frame_source({'end_image_source': 'imaginary'})


def test_intermediate_positions_keep_public_one_based_protocol_and_real_images():
    request = video_request({'video_length': 129, 'end_frame_padding': 8}, '', '', '',
                            Path('/start'), Path('/end'), [(33, Path('/pose1')), (129, Path('/end'))])
    assert request['video_length'] == 137
    assert request['frames_positions'] == '33 129'
    assert request['image_refs'] == ['/pose1', '/end']
    assert request['video_prompt_type'] == 'KFI'
    assert request['keyframe_inject_mode'] == 'replace'
    assert request['injection_strength'] == 1


@pytest.mark.parametrize('positions', [[1], [33, 33], [65, 33], [137]])
def test_invalid_intermediate_positions_are_rejected(positions):
    with pytest.raises(ValueError, match='positions must increase'):
        video_request({'video_length': 137}, '', '', '', Path('/start'), Path('/end'),
                      [(position, Path('/pose')) for position in positions])


def test_end_edit_is_conditioned_on_the_exact_start_frame():
    base = {'model_type': 'image-model', 'image_refs': ['stale.png'], 'NAG_scale': 1.5}
    request = end_frame_request(base, 'Same room.', 'Switch on only the bulb.', Path('/outputs/start.jpg'))
    assert request['image_refs'] == ['/outputs/start.jpg']
    assert request['prompt'] == 'Same room. Switch on only the bulb.'
    assert request['video_prompt_type'] == 'KI'
    assert (request['image_mode'], request['video_length'], request['NAG_scale']) == (1, 1, 1.5)
    assert base['image_refs'] == ['stale.png']


@pytest.mark.parametrize('prompt', [None, '', '   '])
def test_end_frame_requires_an_explicit_edit_recipe(prompt):
    with pytest.raises(ValueError, match='explicit edit prompt'):
        end_frame_request({}, '', prompt, Path('/start.jpg'))


def test_video_conditioning_uses_explicit_keyframes_and_preserves_model_settings():
    base = {'model_type': 'video-model', 'seed': 42, 'image_end': '/stale.jpg', 'image_prompt_type': 'SE'}
    ordinary = video_request(base, 'negative', 'style', 'action', Path('/start.jpg'))
    conditioned = video_request(base, 'negative', 'style', 'action', Path('/start.jpg'), Path('/end.jpg'))
    assert ordinary['image_prompt_type'] == 'S'
    assert 'image_end' not in ordinary
    assert conditioned['image_prompt_type'] == 'SE'
    assert conditioned['image_end'] == '/end.jpg'
    assert conditioned['image_start'] == '/start.jpg'
    assert conditioned['seed'] == 42
    assert base['image_end'] == '/stale.jpg'


def test_end_trim_budget_is_native_generation_not_repeated_delivery_frames():
    params = {'video_length': 129, 'sliding_window_size': 129, 'end_frame_padding': 8}
    ordinary = video_request(params, '', '', '', Path('/start.jpg'))
    conditioned = video_request(params, '', '', '', Path('/start.jpg'), Path('/end.jpg'))
    assert ordinary['video_length'] == 129
    assert 'end_frame_padding' not in ordinary
    assert conditioned['video_length'] == 137
    assert conditioned['sliding_window_size'] == 137
    assert 'end_frame_padding' not in conditioned
    params['sliding_window_size'] = 81
    assert video_request(params, '', '', '', Path('/s'), Path('/e'))['sliding_window_size'] == 81
    assert params['video_length'] == 129


@pytest.mark.parametrize('padding', [-1, 1.5, True, '8'])
def test_invalid_end_trim_budget_is_rejected(padding):
    with pytest.raises(ValueError, match='nonnegative integer'):
        video_request({'end_frame_padding': padding}, '', '', '', Path('/s'), Path('/e'))
