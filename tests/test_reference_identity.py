"""Unit tests for the measurable identity metric (lens count).

The metric turns "the robot has three lenses" into a number that a gate can
fail on, so its own behaviour has to be pinned down: three cyan disks count
as three, a fourth one counts as four, and a wrong anchor raises with an
actionable message.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.reference_identity import (
    EXPECTED_LENSES, analyse, check_anchor_lenses, count_lenses,
)

cv2 = pytest.importorskip('cv2')
np = pytest.importorskip('numpy')


def _frame(centres, radius=26, size=(640, 360)):
    """Draw bright cyan disks on a neutral gray background."""
    image = np.full((size[1], size[0], 3), 160, dtype=np.uint8)
    for x, y in centres:
        cv2.circle(image, (x, y), radius, (255, 255, 40), thickness=-1)
    return image


def _triangle():
    return [(200, 120), (320, 120), (260, 210)]


def _diamond():
    return [(200, 120), (320, 120), (260, 210), (260, 60)]


def test_three_lenses_are_counted_as_three():
    assert count_lenses(_frame(_triangle())) == EXPECTED_LENSES


def test_four_lenses_are_counted_as_four():
    assert count_lenses(_frame(_diamond())) == 4


def test_gray_frame_has_no_lenses():
    assert count_lenses(np.full((360, 640, 3), 160, dtype=np.uint8)) == 0


def test_analyse_reports_the_distribution(tmp_path):
    path = tmp_path / 'frame.png'
    cv2.imwrite(str(path), _frame(_triangle()))
    result = analyse(path)
    assert result['frames'] == 1
    assert result['distribution'] == {EXPECTED_LENSES: 1}
    assert result['share_with_expected'] == 1.0


def test_check_anchor_lenses_accepts_three(tmp_path):
    path = tmp_path / 'anchor.png'
    cv2.imwrite(str(path), _frame(_triangle()))
    assert check_anchor_lenses(path)['distribution'] == {EXPECTED_LENSES: 1}


def test_check_anchor_lenses_rejects_four_and_names_the_working_seeds(tmp_path):
    path = tmp_path / 'anchor.png'
    cv2.imwrite(str(path), _frame(_diamond()))
    with pytest.raises(ValueError) as error:
        check_anchor_lenses(path)
    message = str(error.value)
    assert '4' in message
    assert '99' in message


def test_check_shot_lenses_accepts_exact_count(tmp_path):
    from app.services.reference_identity import check_shot_lenses
    path = tmp_path / 'S03-image.png'
    cv2.imwrite(str(path), _frame(_triangle()))
    assert check_shot_lenses(path)['distribution'] == {EXPECTED_LENSES: 1}


def test_check_shot_lenses_rejects_mismatch(tmp_path):
    from app.services.reference_identity import check_shot_lenses
    path = tmp_path / 'S07-image.png'
    cv2.imwrite(str(path), _frame(_diamond()))
    with pytest.raises(ValueError) as error:
        check_shot_lenses(path)
    assert 'must show exactly 3 cyan lenses' in str(error.value)
