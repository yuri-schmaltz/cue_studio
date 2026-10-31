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


def test_check_cube_lamp_separation_passes_when_separated(tmp_path):
    from app.services.reference_cube import check_cube_lamp_separation
    # Frame with red cube at (100, 100) and warm bulb at (300, 100)
    img = np.full((360, 640, 3), 160, dtype=np.uint8)
    cv2.rectangle(img, (80, 80), (120, 120), (20, 20, 215), thickness=-1)
    # Warm bulb: HSV h in [10, 40], s>=120, v>=170 -> BGR
    bulb_hsv = np.uint8([[[25, 200, 220]]])
    bulb_bgr = cv2.cvtColor(bulb_hsv, cv2.COLOR_HSV2BGR)[0][0]
    cv2.rectangle(img, (280, 80), (320, 120), tuple(int(c) for c in bulb_bgr), thickness=-1)
    
    path = tmp_path / 'shot.png'
    cv2.imwrite(str(path), img)
    res = check_cube_lamp_separation(path, sample=1, min_gap=0)
    assert res['verdict'] == 'separated'
    assert res['min_gap'] > 0


def test_check_cube_lamp_separation_fails_when_overlapping(tmp_path):
    from app.services.reference_cube import check_cube_lamp_separation
    # Overlapping bounding boxes: red cube at (80, 80)-(120, 120), bulb at (100, 100)-(150, 150)
    # The cube is outside the bulb's top-left, so both keep their blobs and overlap in [100, 120]
    img = np.full((360, 640, 3), 160, dtype=np.uint8)
    cv2.rectangle(img, (70, 70), (120, 120), (20, 20, 215), thickness=-1)
    bulb_hsv = np.uint8([[[25, 200, 220]]])
    bulb_bgr = cv2.cvtColor(bulb_hsv, cv2.COLOR_HSV2BGR)[0][0]
    cv2.rectangle(img, (100, 100), (150, 150), tuple(int(c) for c in bulb_bgr), thickness=-1)
    
    path = tmp_path / 'shot_overlap.png'
    cv2.imwrite(str(path), img)
    with pytest.raises(ValueError, match='lamp bulb and red cube overlap'):
        check_cube_lamp_separation(path, sample=1, min_gap=0)


def test_real_wooden_workshop_is_not_a_glowing_bulb():
    import json
    import hashlib
    from pathlib import Path
    from app.services.reference_cube import lamp_bulb_blobs

    fixture = Path(__file__).parent / 'fixtures' / 'reference_bulb'
    labels = json.loads((fixture / 'labels.json').read_text())['cases']
    for case in labels:
        path = fixture / case['image']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == case['source_sha256']
        blobs = lamp_bulb_blobs(cv2.imread(str(path)))
        assert len(blobs) == case['glowing_bulbs'], (case['image'], blobs)
        if case['bulb_box']:
            x, y, w, h = case['bulb_box']
            blob = blobs[0]
            intersection = max(0, min(x + w, blob['x'] + blob['w']) - max(x, blob['x'])) * max(0, min(y + h, blob['y'] + blob['h']) - max(y, blob['y']))
            union = w * h + blob['w'] * blob['h'] - intersection
            assert intersection / union >= 0.6, (case['image'], blob)


def test_unmeasurable_separation_is_never_reported_as_separated(tmp_path):
    from app.services.reference_cube import check_cube_lamp_separation
    path = tmp_path / 'no-glowing-bulb.png'
    cv2.imwrite(str(path), np.full((360, 640, 3), 160, dtype=np.uint8))
    result = check_cube_lamp_separation(path)
    assert result['verdict'] == 'not_measurable'
    assert result['measurable'] is False
    with pytest.raises(ValueError, match='separation is unverified'):
        check_cube_lamp_separation(path, require_pair=True)
