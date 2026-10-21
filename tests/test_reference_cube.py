"""Unit tests for the measurable red-cube continuity metric.

The red cube must exist exactly once in the shots that show it: the
creative review of the F2 master rejected the film because one shot held
two cubes. The metric therefore has to distinguish the real cube from
warm wood, from the amber lamp glow and from a soft red shadow.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.reference_cube import (
    CUBE_ANCHOR_SEEDS, analyse, check_cube_count, count_cubes,
)

cv2 = pytest.importorskip('cv2')
np = pytest.importorskip('numpy')


def _frame(cubes, size=(640, 360), background=160):
    """Draw matte red squares on a neutral gray background."""
    image = np.full((size[1], size[0], 3), background, dtype=np.uint8)
    for x, y in cubes:
        cv2.rectangle(image, (x - 18, y - 18), (x + 18, y + 18), (20, 20, 215), thickness=-1)
    return image


def test_single_cube_is_counted_as_one():
    assert count_cubes(_frame([(200, 150)])) == 1


def test_two_cubes_are_counted_as_two():
    assert count_cubes(_frame([(150, 150), (420, 150)])) == 2


def test_gray_frame_has_no_cube():
    assert count_cubes(np.full((360, 640, 3), 160, dtype=np.uint8)) == 0


def test_amber_warm_patch_is_not_a_cube():
    """Wood and the lamp glow live in the same orange region as the cube."""
    image = np.full((360, 640, 3), 160, dtype=np.uint8)
    cv2.rectangle(image, (180, 140), (220, 180), (30, 90, 170), thickness=-1)
    assert count_cubes(image) == 0


def test_shadowed_red_patch_is_not_a_cube():
    """A dim, low-value red surface is not the saturated matte cube.

    The darkest cube of the corrected renders measures 107 in median
    value and the warm wood edges that share its hue measure 75-90, so
    the floor of the metric sits between the two.
    """
    image = np.full((360, 640, 3), 160, dtype=np.uint8)
    cv2.rectangle(image, (180, 140), (220, 180), (25, 25, 90), thickness=-1)
    assert count_cubes(image) == 0


def test_close_up_cube_is_counted_as_one():
    """The cube grows with the framing, so no absolute size cap applies.

    The corrected renders show the cube at 46 px in a wide shot and at
    177 px in the close-up of the hand. A cap in pixels rejected real
    cubes; the metric is bounded relative to the frame instead.
    """
    image = np.full((720, 1280, 3), 160, dtype=np.uint8)
    cv2.rectangle(image, (600, 250), (776, 434), (20, 20, 215), thickness=-1)
    assert count_cubes(image) == 1


def test_red_surface_covering_the_frame_is_not_a_cube():
    """A red wall is scenery, not a fist-sized object in the room."""
    image = np.full((720, 1280, 3), 160, dtype=np.uint8)
    cv2.rectangle(image, (100, 100), (1100, 600), (20, 20, 215), thickness=-1)
    assert count_cubes(image) == 0


def test_analyse_reports_the_distribution(tmp_path):
    path = tmp_path / 'frame.png'
    cv2.imwrite(str(path), _frame([(200, 150)]))
    result = analyse(path)
    assert result['frames'] == 1
    assert result['distribution'] == {1: 1}
    assert result['max_count'] == 1


def test_check_cube_count_accepts_one(tmp_path):
    path = tmp_path / 'frame.png'
    cv2.imwrite(str(path), _frame([(200, 150)]))
    result = check_cube_count(path, expected=1)
    assert result['max_count'] == 1


def test_check_cube_count_rejects_a_duplicated_cube(tmp_path):
    path = tmp_path / 'frame.png'
    cv2.imwrite(str(path), _frame([(150, 150), (420, 150)]))
    with pytest.raises(ValueError) as error:
        check_cube_count(path, expected=1)
    assert 'cube' in str(error.value).lower()


def test_check_cube_count_rejects_a_missing_cube(tmp_path):
    path = tmp_path / 'frame.png'
    cv2.imwrite(str(path), np.full((360, 640, 3), 160, dtype=np.uint8))
    with pytest.raises(ValueError):
        check_cube_count(path, expected=1)


def test_anchor_seeds_are_declared():
    assert CUBE_ANCHOR_SEEDS
    assert all(isinstance(seed, int) for seed in CUBE_ANCHOR_SEEDS)
