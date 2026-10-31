from pathlib import Path

import pytest

from app.services.reference_visuals import ReferenceVisuals


def recipe():
    return {'style': 'Style.', 'character': 'Robot.', 'location': 'Room.', 'shots': {
        'S06': {'image': 'Carry cube.', 'motion': 'Walk to socket.', 'end_image': 'Robot beside socket.',
                'keyframes': [{'frame': 33, 'prompt': 'First real step.'}, {'frame': 129, 'source': 'end'}]},
        'S07': {'image': 'Pause at socket.', 'motion': 'Pause.',
                'image_source': 'S06-end-image', 'end_image_source': 'start'},
    }}


def test_continuous_shots_reuse_real_final_state_without_inventing_alias_jobs():
    requests = {}

    def generate(label, request, extensions):
        assert label not in requests
        requests[label] = request
        return Path('/outputs') / (label + '.png')

    visuals = ReferenceVisuals(recipe(), {'seed': 42}, generate)
    assert visuals.end('S07') == Path('/outputs/S06-end-image.png')
    assert set(requests) == {'anchor-character', 'anchor-location', 'S06-image', 'S06-end-image'}
    assert requests['S06-end-image']['image_refs'] == ['/outputs/S06-image.png']
    keyframes = visuals.keyframes('S06')
    assert keyframes == [(33, Path('/outputs/S06-keyframe-33-image.png')), (129, Path('/outputs/S06-end-image.png'))]
    assert requests['S06-keyframe-33-image']['image_refs'] == ['/outputs/S06-image.png']
    assert visuals.image('S07') == visuals.end('S06')
    assert 'S07-image' not in requests
    assert 'S06-keyframe-129-image' not in requests
    visuals.keyframes('S06')
    assert len(requests) == 5


@pytest.mark.parametrize('problem', ['missing', 'cycle', 'duplicate_position', 'missing_end'])
def test_invalid_dependency_graph_fails_before_any_job(problem):
    data = recipe()
    if problem == 'missing':
        data['shots']['S07']['image_source'] = 'S99-image'
    elif problem == 'cycle':
        data['shots']['S06']['image_source'] = 'S07-image'
    elif problem == 'duplicate_position':
        data['shots']['S06']['keyframes'][1]['frame'] = 33
    else:
        del data['shots']['S06']['end_image']
        data['shots']['S07'].pop('image_source')

    def never_generate(*args):
        pytest.fail('Invalid dependencies must not submit model jobs')

    with pytest.raises(ValueError):
        ReferenceVisuals(data, {}, never_generate)
