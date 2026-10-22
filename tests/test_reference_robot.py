"""Unit tests for the measurable scale of the robot (head width and ruler).

The head of the robot is the only reliable marker of its size, so the
measurement has to describe the head in every shot: a close-up draws a
bigger head than a wide shot, but the head is the same head. These tests
pin that down, together with the gate that compares the robot against
the cube it carries along the whole film.
"""
from __future__ import annotations

import pytest

from app.services.reference_robot import analyse, head_cluster
from app.services.reference_continuity import (
    check_scale_consistency, head_to_cube_ratio,
)

cv2 = pytest.importorskip('cv2')
np = pytest.importorskip('numpy')


def _head(centres, radius=20, size=(640, 360)):
    """Draw a head of three cyan lenses on a neutral gray background."""
    image = np.full((size[1], size[0], 3), 160, dtype=np.uint8)
    for x, y in centres:
        cv2.circle(image, (x, y), radius, (255, 255, 40), thickness=-1)
    return image


def _triangle(centre=(320, 180), radius=20):
    """Three lenses in a triangle: two on top, one centred below.

    The distance between the lenses and their own size both follow the
    radius, so scaling the radius draws the same head bigger.
    """
    return [(centre[0] - radius, centre[1] - radius),
            (centre[0] + radius, centre[1] - radius),
            (centre[0], centre[1] + radius)]


def _scaled_head(radius, centre=(320, 180)):
    """The head drawn at one size: bigger radius, bigger spacing."""
    return _head(_triangle(centre, radius), radius=radius)


def _cube(image, centre=(320, 300), half=15):
    """Draw a matte red cube on the frame."""
    image[centre[1] - half:centre[1] + half, centre[0] - half:centre[0] + half] = (20, 20, 190)
    return image


def test_head_is_measured_from_the_span_of_its_three_lenses():
    head = head_cluster(_head(_triangle()))
    assert head is not None
    assert head['lenses'] == 3
    # The span reaches from the left edge of the left lens to the right
    # edge of the right one, so it is wider than a single lens.
    assert head['w'] > 40


def test_head_width_scales_with_the_size_of_the_head():
    small = head_cluster(_scaled_head(20))
    large = head_cluster(_scaled_head(40))
    assert small is not None and large is not None
    assert large['w'] > small['w'] * 1.8


def test_the_measured_head_is_the_same_head_at_two_sizes():
    """The width has to grow with the drawing, not with the drawing alone."""
    small = head_cluster(_scaled_head(20))
    large = head_cluster(_scaled_head(40))
    # The same triangle is scaled: the span of the three lenses has to
    # double, which is what makes the number comparable between a
    # close-up and a wide shot.
    assert abs(large['w'] / small['w'] - 2.0) < 0.25


def test_a_head_of_two_lenses_is_not_measured():
    assert head_cluster(_head(_triangle()[:2])) is None


def test_a_cyan_highlight_that_is_not_round_is_not_a_lens():
    image = np.full((360, 640, 3), 160, dtype=np.uint8)
    cv2.rectangle(image, (100, 100), (300, 130), (255, 255, 40), thickness=-1)
    cv2.rectangle(image, (100, 160), (300, 190), (255, 255, 40), thickness=-1)
    cv2.rectangle(image, (100, 220), (300, 250), (255, 255, 40), thickness=-1)
    assert head_cluster(image) is None


def test_a_highlight_next_to_the_lenses_does_not_shrink_the_head():
    """A small bright spot on the head is not a fourth lens.

    The three lenses of a head are the same size, so a blob much
    smaller than the others is a highlight. Without this rule the
    detector would group the highlight with two lenses and measure a
    head of half its real size, which reads as a robot that changes
    size inside the shot.
    """
    image = _scaled_head(20)
    cv2.circle(image, (300, 180), 3, (255, 255, 40), thickness=-1)
    head = head_cluster(image)
    assert head is not None
    assert head['w'] == pytest.approx(head_cluster(_scaled_head(20))['w'], rel=0.05)


def test_a_head_of_lenses_of_very_different_sizes_is_not_measured():
    """Three blobs of very different sizes are not three lenses."""
    image = np.full((360, 640, 3), 160, dtype=np.uint8)
    cv2.circle(image, (300, 160), 20, (255, 255, 40), thickness=-1)
    cv2.circle(image, (340, 160), 20, (255, 255, 40), thickness=-1)
    cv2.circle(image, (320, 200), 4, (255, 255, 40), thickness=-1)
    assert head_cluster(image) is None


def test_the_ruler_measures_the_head_against_the_cube():
    image = _cube(_head(_triangle()))
    ratio = head_to_cube_ratio(image)
    assert ratio is not None
    # The ruler divides the span of the three lenses by the width of the
    # cube, so it has to follow from the two measured widths.
    head = head_cluster(image)
    assert head is not None
    assert ratio == pytest.approx(head['w'] / 30, rel=0.05)


def test_the_ruler_needs_exactly_one_cube():
    image = _cube(_head(_triangle()))
    assert head_to_cube_ratio(image) is not None
    image[260:300, 500:540] = (20, 20, 190)
    assert head_to_cube_ratio(image) is None


def test_a_robot_that_keeps_its_size_passes_the_film_gate():
    measurements = {
        'S04': {'measurable': True, 'median_ratio': 2.10},
        'S06': {'measurable': True, 'median_ratio': 2.16},
        'S07': {'measurable': True, 'median_ratio': 2.02},
    }
    result = check_scale_consistency(measurements)
    assert result['verdict'] == 'consistent'
    assert result['spread'] < 1.25


def test_a_robot_that_changes_size_along_the_film_fails():
    """This is the defect the creative review of the v6 master rejected."""
    measurements = {
        'S04': {'measurable': True, 'median_ratio': 1.55},
        'S06': {'measurable': True, 'median_ratio': 0.90},
        'S07': {'measurable': True, 'median_ratio': 0.91},
    }
    with pytest.raises(ValueError, match='changes size along the film'):
        check_scale_consistency(measurements)


def test_shots_without_a_measurable_ruler_do_not_decide_the_gate():
    measurements = {
        'S04': {'measurable': True, 'median_ratio': 2.10},
        'S06': {'measurable': False, 'median_ratio': None},
        'S07': {'measurable': True, 'median_ratio': 2.02},
    }
    assert check_scale_consistency(measurements)['verdict'] == 'consistent'
    assert check_scale_consistency({'S06': measurements['S06']})['verdict'] == 'not-measurable'


def test_scale_consistency_fails_when_required_shots_not_measurable():
    measurements = {
        'S04': {'measurable': True, 'median_ratio': 2.10},
        'S06': {'measurable': False, 'median_ratio': None},
        'S07': {'measurable': True, 'median_ratio': 2.02},
    }
    with pytest.raises(ValueError, match='Required scale consistency shots not measurable: S06'):
        check_scale_consistency(measurements, required_shots={'S04', 'S06', 'S07'})


def test_a_still_is_measured_the_same_way_as_a_clip(tmp_path):
    """The metric reads a still and a clip with the same code."""
    path = tmp_path / 'head.png'
    cv2.imwrite(str(path), _head(_triangle()))
    result = analyse(path)
    assert result['frames'] == 1
    assert result['median_width'] > 0
