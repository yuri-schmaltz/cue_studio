from pathlib import Path

import pytest

from app.services.reference_continuity import check_lateral_carry_keyframes

cv2 = pytest.importorskip('cv2')
np = pytest.importorskip('numpy')


def frames(tmp_path, positions, leave_cube=False, missing_head=False):
    paths = []
    for i, x in enumerate(positions):
        image = np.full((360, 640, 3), 160, dtype=np.uint8)
        if not (missing_head and i == 2):
            for cx, cy in [(x - 18, 140), (x + 18, 140), (x, 176)]:
                cv2.circle(image, (cx, cy), 12, (255, 255, 40), -1)
        cube_x = positions[0] - 50 if leave_cube else x - 50
        cv2.rectangle(image, (cube_x - 10, 210), (cube_x + 10, 230), (20, 20, 215), -1)
        path = tmp_path / f'{i}.png'
        cv2.imwrite(str(path), image)
        paths.append(path)
    return paths


@pytest.mark.parametrize('positions,direction', [([80, 160, 240, 320, 400], 'right'),
                                                ([500, 420, 340, 260, 180], 'left')])
def test_real_progress_between_states_is_measured(tmp_path, positions, direction):
    result = check_lateral_carry_keyframes(frames(tmp_path, positions), direction=direction)
    assert result['verdict'] == 'progressing'
    assert result['travel_fraction'] == 0.5
    assert all(step > 0 for step in result['step_fractions'])


@pytest.mark.parametrize('positions', [[80, 80, 80, 80, 400], [80, 160, 140, 320, 400],
                                      [80, 100, 120, 140, 550], [80, 80, 80, 80, 80]])
def test_stalling_reversal_and_teleport_do_not_become_a_valid_carry(tmp_path, positions):
    with pytest.raises(ValueError):
        check_lateral_carry_keyframes(frames(tmp_path, positions))


def test_a_cube_left_behind_and_unmeasurable_head_are_rejected(tmp_path):
    for options in ({'leave_cube': True}, {'missing_head': True}):
        with pytest.raises(ValueError):
            check_lateral_carry_keyframes(frames(tmp_path, [80, 160, 240, 320, 400], **options))
