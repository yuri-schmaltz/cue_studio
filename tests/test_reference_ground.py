"""Unit tests for the measurable ground contact of the robot.

The robot's light gray body cannot be segmented from the wall and from
the wooden floor, so the shadow it casts on the floor is the only
marker of the floor plane under it. These tests pin down what the
metric measures, that a robot floating above its shadow is read as
higher than a robot standing on it, and that a frame without a cast
shadow is reported as not measurable instead of as a made-up number.
"""
from __future__ import annotations

import math

import pytest

from app.services.reference_ground import (
    MIN_STAND_IN_HEAD_WIDTHS, analyse, contact,
)
from app.services.reference_robot import head_cluster

cv2 = pytest.importorskip('cv2')
np = pytest.importorskip('numpy')

FLOOR_VALUE = 150
SHADOW_VALUE = 60
RADIUS = 18
HEAD_CENTRE = (320, 110)


def _lens_centres(centre=HEAD_CENTRE, radius=RADIUS):
    """Three well separated lenses: two on top, one centred below.

    The lenses are kept apart from each other, so a codec that smears
    the picture a little does not merge them into one blob.
    """
    x, y = centre
    return [(x - 1.5 * radius, y - 0.5 * radius),
            (x + 1.5 * radius, y - 0.5 * radius),
            (x, y + 1.2 * radius)]


def _head_bottom(centre=HEAD_CENTRE, radius=RADIUS):
    """The bottom of the lowest lens."""
    return math.ceil(centre[1] + 2.2 * radius)


def _scene(shadow_offset=0, centre=HEAD_CENTRE, radius=RADIUS, size=(640, 360)):
    """Draw a robot head over a floor, with a cast shadow at a distance.

    ``shadow_offset`` is the number of rows between the bottom of the
    head and the top of the shadow: a robot standing on the floor casts
    its shadow at its feet, a robot floating above it casts the shadow
    further down.
    """
    image = np.full((size[1], size[0], 3), FLOOR_VALUE, dtype=np.uint8)
    for x, y in _lens_centres(centre, radius):
        cv2.circle(image, (int(x), int(y)), radius, (255, 255, 40), thickness=-1)
    top = int(_head_bottom(centre, radius) + shadow_offset)
    if top + 8 < size[1]:
        image[top:top + 8, 200:440] = SHADOW_VALUE
    return image


def test_a_standing_robot_is_measured_on_its_own_shadow():
    image = _scene(shadow_offset=100)
    measured = contact(image)
    assert measured is not None
    head = head_cluster(image)
    # The raster of the circle costs a row here or there.
    assert abs(measured['stand_px'] - 100) <= 2
    assert measured['stand_head_widths'] == pytest.approx(100 / head['w'], abs=0.03)


def test_a_floating_robot_stands_further_above_its_shadow():
    grounded = contact(_scene(shadow_offset=100))
    floating = contact(_scene(shadow_offset=200))
    assert grounded is not None
    assert floating is not None
    assert floating['stand_head_widths'] > grounded['stand_head_widths']
    assert floating['stand_px'] - grounded['stand_px'] == 100


def test_the_shadow_of_the_head_itself_is_not_read_as_the_floor():
    # Without a floor shadow the only dark band below the head is the
    # underside of the head, and the metric must refuse to measure it
    # instead of reporting a stand height of a few hundredths.
    assert contact(_scene(shadow_offset=0)) is None


def test_a_frame_without_a_head_is_not_measurable():
    image = np.full((360, 640, 3), FLOOR_VALUE, dtype=np.uint8)
    image[200:208, 200:440] = SHADOW_VALUE
    assert contact(image) is None


def test_a_still_without_a_shadow_is_reported_as_not_measurable(tmp_path):
    path = tmp_path / 'flat.png'
    cv2.imwrite(str(path), _scene(shadow_offset=0))
    result = analyse(path)
    assert result['detections'] == 0
    assert result['measurable'] is False
    assert result['median_stand_head_widths'] is None
    assert result['indicative'] is False
    assert 'no floor shadow' in result['note']


def test_a_still_with_a_shadow_is_measured(tmp_path):
    path = tmp_path / 'shadow.png'
    cv2.imwrite(str(path), _scene(shadow_offset=100))
    result = analyse(path)
    assert result['detections'] == 1
    assert result['measurable'] is False  # a single frame is not a shot
    assert result['median_stand_head_widths'] is not None


def test_a_shot_with_too_few_shadowed_frames_is_only_indicative(tmp_path):
    # The number exists but describes too few frames to be a measurement
    # of the shot, and the artifact has to say so: this is exactly the
    # case of the rejected master, whose S07 sits at a coverage of 0.20
    # and whose median is 4.51 against the 2.03 of the new master.
    path = tmp_path / 'sparse.avi'
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'MJPG'), 24, (640, 360))
    for index in range(12):
        writer.write(_scene(shadow_offset=100 if index % 4 == 0 else 0))
    writer.release()
    result = analyse(path)
    assert result['detections'] == 3
    assert result['coverage'] == pytest.approx(0.25, abs=0.01)
    assert result['measurable'] is False
    assert result['indicative'] is True
    assert 'indicative' in result['note']


def test_a_clip_with_a_shadow_is_measured(tmp_path):
    path = tmp_path / 'shadow.avi'
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'MJPG'), 24, (640, 360))
    for _ in range(12):
        writer.write(_scene(shadow_offset=100))
    writer.release()
    result = analyse(path)
    assert result['detections'] == 12
    assert result['measurable'] is True
    head = head_cluster(_scene(shadow_offset=100))
    assert result['median_stand_head_widths'] == pytest.approx(100 / head['w'], abs=0.03)


def test_the_sanity_floor_is_the_one_the_films_justify():
    # The band under the head is 0.15-0.35 head widths below it in
    # every measurable shot of both films, so the floor has to sit
    # above it or the metric measures the head's own chin.
    assert MIN_STAND_IN_HEAD_WIDTHS >= 0.5
