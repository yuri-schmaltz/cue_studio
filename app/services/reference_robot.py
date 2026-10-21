"""Measurable scale of the film's robot.

The creative review of the F2 master rejected the film because the robot
changed size along the way and because it floated between the table and
the lamp pedestal. The head is the only reliable marker of the robot: the
cyan lenses are the only saturated cyan surface in the workshop, while the
light gray body shares its value range with the wall, so the body cannot
be segmented by colour.

The metric is therefore deliberately narrow and honest:

* it measures the width of the cyan head cluster, and only on the frames
  where the three lenses are visible as three separate blobs, so the head
  is fully facing the camera and the measurement is comparable frame to
  frame;
* it measures the head as the *span of its three lenses* rather than as
  the size of a merged blob. The lenses sit in a triangle, so their span
  describes the head in every shot; merging them by an absolute pixel
  distance instead measures a different thing in a close-up than in a
  wide shot, which is precisely where the ruler has to be comparable;
* it reports a number only when enough frames qualify, because in a wide
  shot the robot is a few pixels tall and any ratio would be noise;
* it compares the head size *inside* one shot. The apparent size of the
  robot in two different shots is not comparable: a close-up is supposed
  to show a bigger robot than a wide shot, and the script asks for
  exactly that. The size of the robot relative to the room is written
  into the prompts and checked by the human review; what this module
  guarantees is that the robot does not change size while the shot runs.
"""
from __future__ import annotations

from itertools import combinations
from pathlib import Path

# The lenses are the same cyan as in the identity metric, with a lower
# area floor: in a wide shot a single lens covers a few dozen pixels.
HUE_MIN, HUE_MAX = 80, 105
SAT_MIN, VAL_MIN = 80, 80
MIN_BLOB_AREA = 30
# A cyan blob only counts as a lens when it is round enough to be one.
# The lenses are the only saturated cyan in the workshop, but a cyan
# highlight on the floor or a rim light on an arm has the same hue, and
# a shape test is what tells the two apart. The band is wider than the
# identity metric's because a lens seen at an angle is taller than it
# is wide.
MIN_LENS_FILL = 0.45
MIN_LENS_ASPECT, MAX_LENS_ASPECT = 0.55, 1.80
# The head carries its three lenses in a triangle, so the three lenses
# never spread wider than this multiple of the largest of them. A group
# of cyan blobs spread wider than that is not a head.
MAX_HEAD_SPAN_IN_LENSES = 4.0
# The head must be fully visible (three separate lenses) in at least this
# share of the sampled frames before the shot is called measurable.
MIN_COVERAGE = 0.3
# Below this head width the cluster is image noise, not a robot head.
MIN_HEAD_WIDTH = 12
# At least this many qualifying frames are needed for a ratio.
MIN_FRAMES = 4
# The robot may not grow or shrink by more than this factor between the
# small and the large end of the qualifying frames of a shot.
MAX_DRIFT = 1.8
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}


def _cv2():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - environment guard
        raise RuntimeError('opencv-python is required for the robot metric') from exc
    return cv2


def _numpy():
    import numpy as np
    return np


def _cyan_blobs(image) -> list[tuple[int, int, int, int, int]]:
    """Return (area, left, top, width, height) of every cyan blob."""
    cv2 = _cv2()
    np = _numpy()
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(
        hsv,
        np.array([HUE_MIN, SAT_MIN, VAL_MIN], dtype=np.uint8),
        np.array([HUE_MAX, 255, 255], dtype=np.uint8),
    )
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    blobs = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < MIN_BLOB_AREA:
            continue
        blobs.append((area, int(stats[label, cv2.CC_STAT_LEFT]), int(stats[label, cv2.CC_STAT_TOP]),
                      int(stats[label, cv2.CC_STAT_WIDTH]), int(stats[label, cv2.CC_STAT_HEIGHT])))
    return sorted(blobs, key=lambda blob: -blob[0])


def _lenses(blobs: list[tuple[int, int, int, int, int]]) -> list[tuple[int, int, int, int, int]]:
    """Keep only the blobs that are round enough to be a lens."""
    lenses = []
    for area, x, y, width, height in blobs:
        if not width or not height:
            continue
        fill = area / (width * height)
        aspect = width / height
        if fill < MIN_LENS_FILL or not MIN_LENS_ASPECT <= aspect <= MAX_LENS_ASPECT:
            continue
        lenses.append((area, x, y, width, height))
    return lenses


def _head_group(lenses: list[tuple[int, int, int, int, int]]) -> list[tuple[int, int, int, int, int]] | None:
    """Return the three lenses that belong to one head, if there are three.

    The head carries its lenses in a triangle, so the three lenses of one
    head are the three that sit closest together. Picking the tightest
    group instead of merging by an absolute pixel distance is what makes
    the measurement comparable between a close-up and a wide shot: an
    absolute distance merges the three lenses of a close-up into one
    blob and splits the lenses of a wide shot into several, so the
    measured width stops describing the head at all.
    """
    if len(lenses) < 3:
        return None
    best = None
    best_span = None
    for group in combinations(lenses, 3):
        left = min(item[1] for item in group)
        right = max(item[1] + item[3] for item in group)
        width = right - left
        largest = max(item[3] for item in group)
        if width > MAX_HEAD_SPAN_IN_LENSES * largest:
            continue
        if best_span is None or width < best_span:
            best, best_span = group, width
    return best


def head_cluster(image) -> dict | None:
    """Return the head of the robot in one frame, if it is measurable.

    The head is measured as the span of its three lenses, so the number
    describes the head in every shot: a close-up and a wide shot differ
    in how large the head is drawn, not in how the lenses are arranged.
    The head is only measured when three round lenses are visible: a
    head turned sideways merges its lenses and would otherwise be
    measured as a robot that shrank.
    """
    lenses = _lenses(_cyan_blobs(image))
    group = _head_group(lenses)
    if group is None:
        return None
    left = min(lens[1] for lens in group)
    right = max(lens[1] + lens[3] for lens in group)
    top = min(lens[2] for lens in group)
    bottom = max(lens[2] + lens[4] for lens in group)
    width = right - left
    if width < MIN_HEAD_WIDTH:
        return None
    return {
        'area': sum(lens[0] for lens in group),
        'x': left,
        'y': top,
        'w': width,
        'h': bottom - top,
        'lenses': len(group),
    }


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
    """Measure the head size of the robot over a still or a clip."""
    np = _numpy()
    widths: list[int] = []
    frames = 0
    sampled = 0
    for index, frame in _frames(Path(path)):
        frames += 1
        if index % sample:
            continue
        sampled += 1
        cluster = head_cluster(frame)
        if cluster:
            widths.append(cluster['w'])
    if not frames:
        raise ValueError(f'no frames decoded from {path}')
    coverage = len(widths) / max(1, sampled)
    result = {
        'path': str(path),
        'frames': frames,
        'sampled': sampled,
        'detections': len(widths),
        'coverage': round(coverage, 4),
        'widths': widths,
        'median_width': int(np.median(widths)) if widths else 0,
    }
    result['measurable'] = coverage >= MIN_COVERAGE and len(widths) >= MIN_FRAMES
    if result['measurable']:
        values = np.array(widths)
        small = int(np.percentile(values, 10))
        large = int(np.percentile(values, 90))
        result['small_width'] = small
        result['large_width'] = large
        result['drift_ratio'] = round(large / small, 4) if small else None
    else:
        result['small_width'] = None
        result['large_width'] = None
        result['drift_ratio'] = None
    return result


def check_scale_stability(path: Path, max_drift: float = MAX_DRIFT) -> dict:
    """Fail loudly when the robot changes size inside a shot.

    Shots whose head cannot be measured are reported as evidence only:
    in a wide shot the robot is a few pixels tall, and refusing to
    measure is more honest than reporting a made-up number.
    """
    result = analyse(Path(path))
    if not result['measurable']:
        result['verdict'] = 'not-measurable'
        return result
    drift = result['drift_ratio']
    if drift is None or drift > max_drift:
        result['verdict'] = 'unstable'
        raise ValueError(
            f'{Path(path).name}: the robot changes size inside the shot '
            f'(head width {result["small_width"]} -> {result["large_width"]} px, '
            f'ratio {drift}); the robot must keep one size in every shot.'
        )
    result['verdict'] = 'stable'
    return result
