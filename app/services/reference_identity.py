"""Measurable identity check for the reference film's robot head.

The character design fixes exactly three circular cyan lenses on the head
(two on the upper row, one centred below). The creative review of the F2
master rejected the film because the robot always showed four lenses, so
the count has to be measured instead of eyeballed.

The detector segments cyan pixels in HSV, keeps near-circular blobs and
counts them. Blob size is judged relative to the largest blob in the same
frame so the count stays valid when the robot is small in the shot.

The detector is only trustworthy under neutral light: under warm amber
light the lenses lose saturation and the lamp glow itself can be counted as
a lens. Hard gates therefore apply to the character anchor and to neutral
close-ups; every other shot is recorded as evidence only.
"""
from __future__ import annotations

from pathlib import Path

EXPECTED_LENSES = 3
HUE_MIN, HUE_MAX = 80, 105
# The lenses are bright cyan glass. Requiring high saturation and value
# keeps dark blue trim and shadowed eyes from being counted as lenses.
SAT_MIN, VAL_MIN = 90, 90
MIN_DISK_AREA = 150
# How much of the lens' bounding box the lens itself fills. The rejected
# v6 master was calibrated at 0.55, which rejected the three lenses of the
# corrected v7 renders: they measure 0.486-0.543 there, because the lens
# of the v7 character carries a dark rim that the v6 lens did not have.
# Measured across both films, every real lens fills 0.486-0.802 of its
# box and no shot ever shows a fourth lens at 0.45, so the floor sits
# below the lowest real lens and above nothing that would invent one.
MIN_FILL = 0.45
MIN_ASPECT = 0.65
MAX_ASPECT = 1.55
RELATIVE_AREA = 0.12
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}
# Seeds measured to produce exactly three lenses with the canonical prompt,
# in the order they should be tried.
CHARACTER_ANCHOR_SEEDS = (99, 555, 42, 8, 1234)


def _cv2():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - environment guard
        raise RuntimeError('opencv-python is required for the lens metric') from exc
    return cv2


def _numpy():
    import numpy as np
    return np


def _cyan_mask(image):
    cv2 = _cv2()
    np = _numpy()
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(
        hsv,
        np.array([HUE_MIN, SAT_MIN, VAL_MIN], dtype=np.uint8),
        np.array([HUE_MAX, 255, 255], dtype=np.uint8),
    )
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))


def _disks(image) -> list[tuple[int, float, float]]:
    """Return (area, centre_x, centre_y) for every lens-shaped cyan blob."""
    cv2 = _cv2()
    mask = _cyan_mask(image)
    count, _, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    disks = []
    for label in range(1, count):
        area = stats[label, cv2.CC_STAT_AREA]
        width = stats[label, cv2.CC_STAT_WIDTH]
        height = stats[label, cv2.CC_STAT_HEIGHT]
        if area < MIN_DISK_AREA or not width or not height:
            continue
        fill = area / (width * height)
        aspect = width / height
        if fill < MIN_FILL or not MIN_ASPECT < aspect < MAX_ASPECT:
            continue
        disks.append((int(area), float(centroids[label][0]), float(centroids[label][1])))
    return disks


def count_lenses(image) -> int:
    """Count the lenses visible in one frame."""
    disks = _disks(image)
    if not disks:
        return 0
    largest = max(area for area, _, _ in disks)
    threshold = max(MIN_DISK_AREA, RELATIVE_AREA * largest)
    return sum(1 for area, _, _ in disks if area >= threshold)


def _frames(path: Path):
    cv2 = _cv2()
    if path.suffix.lower() in IMAGE_SUFFIXES:
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError(f'cannot read image: {path}')
        yield 0, image
        return
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f'cannot read video: {path}')
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        yield index, frame
        index += 1
    capture.release()


def analyse(path: Path, sample: int = 1) -> dict:
    """Measure the lens count over a still image or every n-th clip frame."""
    np = _numpy()
    counts = []
    for index, frame in _frames(Path(path)):
        if index % sample:
            continue
        counts.append(count_lenses(frame))
    if not counts:
        raise ValueError(f'no frames decoded from {path}')
    values, frequencies = np.unique(counts, return_counts=True)
    distribution = {int(value): int(frequency) for value, frequency in zip(values, frequencies)}
    correct = distribution.get(EXPECTED_LENSES, 0)
    return {
        'path': str(path),
        'frames': len(counts),
        'lens_counts': counts,
        'distribution': distribution,
        'frames_with_expected': correct,
        'share_with_expected': round(correct / len(counts), 4),
    }


def check_anchor_lenses(path: Path, expected: int = EXPECTED_LENSES) -> dict:
    """Measure the character anchor and fail loudly when it is wrong.

    The anchor is the source of identity for every shot, so a wrong anchor
    silently propagates the defect to the whole film. The error message
    lists the seeds already measured to work, so the failure is actionable.
    """
    result = analyse(Path(path))
    distribution = result['distribution']
    dominant = max(distribution, key=lambda value: distribution[value]) if distribution else 0
    if dominant != expected:
        raise ValueError(
            f'Character anchor {Path(path).name} shows {distribution} lenses instead of '
            f'{expected}; the film identity would be wrong for every shot. '
            f'Seeds measured to give exactly {expected} lenses: '
            f'{", ".join(str(seed) for seed in CHARACTER_ANCHOR_SEEDS)}.'
        )
    return result


def check_shot_lenses(path: Path, expected: int = EXPECTED_LENSES) -> dict:
    """Measure lens count on a shot still or clip and fail loudly if lenses mismatch.

    Used by the F2 reference film harness to ensure the robot retains its three cyan
    lenses in every shot featuring the character.
    """
    result = analyse(Path(path))
    distribution = result['distribution']
    correct = distribution.get(expected, 0)
    if correct != result['frames']:
        raise ValueError(
            f"{Path(path).name} must show exactly {expected} cyan lenses: {distribution}"
        )
    return result


def check_profile_identity(path: Path, expected: int = EXPECTED_LENSES) -> dict:
    """Record a turning head without treating hidden lenses as missing anatomy.

    A lens detector cannot establish head presence in a side/back view. Keep
    that limitation explicit: this evidence never approves identity by itself.
    The frontal anchor and stills retain their exact-count gates.
    """
    result = analyse(Path(path))
    if any(count > expected for count in result['distribution']):
        raise ValueError(f'{Path(path).name}: extra visible lenses: {result["distribution"]}')
    result.update(
        verdict='review-required',
        head_presence='not-measured',
        review_required=['head present throughout', 'same character design through the turn'],
    )
    return result
