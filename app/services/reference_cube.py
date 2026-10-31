"""Measurable count of the film's red cube.

The red cube is the film's continuity object: it is picked up, carried,
seated in the lamp pedestal and must never exist twice. The creative
review of the F2 master rejected the film because one shot showed two
cubes, so the count has to be measured instead of eyeballed.

Detection works on the HSV cone of a saturated matte red surface. The
cone is deliberately narrow (H in [0,6] or [174,179]) because the workshop
is full of warm wood and the lamp glow is amber; both live in the same
orange region and are excluded by the hue limits.

Blobs are also required to look like a cube: a roughly square footprint
and a solid fill. A soft shadow or a wood highlight fails the shape test,
so it is not counted as a second cube.

Four further rules were added after measuring the rejected v6 master and
the corrected v7 renders:

* a blob that touches the frame border is not a cube. The rejected
  master contained a red sliver of scenery cut by the right edge of the
  frame, and counting it invented a second cube in a shot that only ever
  held one;
* the footprint may not be much wider than it is tall. A cube seen at
  an angle is still close to square, while a strip of scenery is not;
* the blob has to be a *lit, saturated, pure* red. The matte cube is the
  only deep red surface of the workshop, while a shaded wood edge keeps
  the hue of the cube but loses its brightness and its purity. The
  purity is measured as the angular distance of the blob's pixels from
  the red pole, which is wrap-safe: OpenCV puts red at 0/179, so a plain
  "hue <= 3" test would reject half of the real cubes;
* the size of the cube is bounded *relative to the frame*, never by an
  absolute number of pixels. The v6 master was calibrated with a
  150 px cap, which was a mistake: the apparent size of the cube follows
  the framing of the shot. The measured v7 renders show the cube at
  46 px wide in the wide shots and at 177 px in the close-up of the
  hand, and the dedicated cube anchor renders it at 388 px, so any
  absolute cap rejects real cubes. The frame-relative bounds only reject
  a red surface that *is* the room.
"""
from __future__ import annotations

from pathlib import Path

# The matte red cube sits at the very top of the hue wheel: OpenCV wraps
# red around 0/179, so both ends of the range are the same colour.
HUE_RANGES = ((0, 6), (174, 179))
SAT_MIN, VAL_MIN = 120, 70
# The smallest measured real cube in the v6 and v7 renders is the one
# seated in the pedestal socket (45x23 px, 524 px of red), so a blob of
# 150 red pixels is already too small to be the cube. The smaller specks
# of the rejected master (130 and 153 px) fall below this bound.
MIN_AREA = 150
# A cube seen at an angle is still close to square. The rejected master
# held a red strip of table at an aspect of 2.23, which is outside this
# band, while every measured cube stays between 0.96 and 1.96.
MIN_FILL = 0.50
MIN_ASPECT, MAX_ASPECT = 0.60, 2.00
# The matte cube is lit; a wood highlight or a soft red shadow is not.
# The measured median value of a real cube is 107-222 across both films,
# while the warm wood edges that share its hue measure 75-90. The floor
# sits between the two: 100 is below the darkest real cube (the one the
# robot carries in S06, at 107) and above the brightest wood edge.
MEDIAN_VAL_MIN = 100
# Every measured real cube is strongly saturated (164-241); a washed-out
# red-brown surface is not the matte cube.
MEDIAN_SAT_MIN = 150
# Angular distance from the red pole, in OpenCV hue degrees, that a blob
# may keep at its median. Every measured cube sits at 1-4 degrees; a
# brown or orange surface drifts to 5-6 and beyond.
MAX_HUE_DISTANCE = 5
# The cube is an object in the room, not the room. Measured relative to
# the frame width, the largest legitimate cube is the dedicated cube
# anchor at 30% (388 px of 1280) and the widest in a shot is 14%
# (177 px); the bounds below only reject a red surface that covers the
# picture.
MAX_CUBE_WIDTH_FRACTION = 0.40
MAX_CUBE_AREA_FRACTION = 0.25
# A blob that touches the frame border is scenery cut by the frame, not a
# cube the shot contains.
BORDER_MARGIN = 2
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}
# Seeds measured to render exactly one red cube with the canonical cube
# prompt, in the order they should be tried.
CUBE_ANCHOR_SEEDS = (42, 7, 99, 21, 1234)


def _cv2():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - environment guard
        raise RuntimeError('opencv-python is required for the cube metric') from exc
    return cv2


def _numpy():
    import numpy as np
    return np


def _red_mask(image):
    cv2 = _cv2()
    np = _numpy()
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    red = np.zeros(hue.shape, dtype=bool)
    for low, high in HUE_RANGES:
        red |= (hue >= low) & (hue <= high)
    mask = (red & (sat >= SAT_MIN) & (val >= VAL_MIN)).astype(np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))


def cube_blobs(image) -> list[dict]:
    """Return every cube-shaped red blob of one frame, largest first."""
    cv2 = _cv2()
    np = _numpy()
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue, val, sat = hsv[:, :, 0], hsv[:, :, 2], hsv[:, :, 1]
    mask = _red_mask(image)
    height, width = mask.shape
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    cubes = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        box_width = int(stats[label, cv2.CC_STAT_WIDTH])
        box_height = int(stats[label, cv2.CC_STAT_HEIGHT])
        if area < MIN_AREA or not box_width or not box_height:
            continue
        fill = area / (box_width * box_height)
        aspect = box_width / box_height
        if fill < MIN_FILL or not MIN_ASPECT < aspect <= MAX_ASPECT:
            continue
        if box_width > MAX_CUBE_WIDTH_FRACTION * width:
            # Too wide to be a fist-sized object in the room: this is the
            # red workshop scenery, not the cube.
            continue
        if area > MAX_CUBE_AREA_FRACTION * width * height:
            continue
        left = int(stats[label, cv2.CC_STAT_LEFT])
        top = int(stats[label, cv2.CC_STAT_TOP])
        if (left <= BORDER_MARGIN or top <= BORDER_MARGIN
                or left + box_width >= width - BORDER_MARGIN
                or top + box_height >= height - BORDER_MARGIN):
            continue
        pixels = labels == label
        # A shaded wood edge keeps the hue of the cube but loses its
        # brightness, so the blob has to be a lit, saturated surface.
        if np.median(val[pixels]) < MEDIAN_VAL_MIN:
            continue
        if np.median(sat[pixels]) < MEDIAN_SAT_MIN:
            continue
        # Purity: the angular distance from the red pole. OpenCV wraps
        # red around 0/179, so the distance is min(hue, 180 - hue).
        blob_hue = hue[pixels].astype(np.int32)
        if np.median(np.minimum(blob_hue, 180 - blob_hue)) > MAX_HUE_DISTANCE:
            continue
        cubes.append({
            'area': area,
            'x': left,
            'y': top,
            'w': box_width,
            'h': box_height,
            'cx': int(centroids[label][0]),
            'cy': int(centroids[label][1]),
        })
    return sorted(cubes, key=lambda cube: -cube['area'])


def _cubes(image) -> list[tuple[int, int, int]]:
    """Return (area, centre_x, centre_y) for every cube-shaped red blob."""
    return [(cube['area'], cube['cx'], cube['cy']) for cube in cube_blobs(image)]


def count_cubes(image) -> int:
    """Count the red cubes visible in one frame."""
    return len(cube_blobs(image))


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
    """Measure the cube count over a still image or every n-th clip frame."""
    np = _numpy()
    counts = []
    for index, frame in _frames(Path(path)):
        if index % sample:
            continue
        counts.append(count_cubes(frame))
    if not counts:
        raise ValueError(f'no frames decoded from {path}')
    values, frequencies = np.unique(counts, return_counts=True)
    distribution = {int(value): int(frequency) for value, frequency in zip(values, frequencies)}
    return {
        'path': str(path),
        'frames': len(counts),
        'cube_counts': counts,
        'distribution': distribution,
        'max_count': max(counts),
    }


def cube_fractions(path: Path) -> dict:
    """Split the frames of a still or a clip by how many cubes they show.

    The creative review of the rejected v6 master reported a scene with
    two cubes, and the audit of that master measured the defect in 47.5%
    of the frames of one shot while a shot whose second blob was scenery
    only showed it in 1.7% of its frames. The fractions are therefore the
    measurement the gate is built on: the count of a single frame cannot
    tell a real second cube from a misdetected highlight.
    """
    result = analyse(Path(path))
    counts = result['cube_counts']
    total = len(counts)
    single = sum(1 for count in counts if count == 1)
    multiple = sum(1 for count in counts if count >= 2)
    none = total - single - multiple
    return {
        'path': result['path'],
        'frames': total,
        'distribution': result['distribution'],
        'absent_frames': none,
        'single_frames': single,
        'multiple_frames': multiple,
        'absent_fraction': round(none / total, 4),
        'single_fraction': round(single / total, 4),
        'multiple_fraction': round(multiple / total, 4),
        'present_fraction': round((single + multiple) / total, 4),
    }


# A shot that shows the cube has to show it in most of its frames, but
# not in all of them: in a close-up the cube can leave the frame. The
# rejected v6 master measured 71.7% of the frames with the cube in S03
# (close-up of the head) and 77.5% in S05 (detail of the hand), so the
# floor is set below both.
MIN_PRESENCE_FRACTION = 0.50
# A second cube that persists is a real second cube. The rejected master
# showed two cubes in 47.5% of the frames of S06 and in 1.7% of the
# frames of S08, where the second blob was a piece of scenery cut by the
# frame.
MAX_DUPLICATE_FRACTION = 0.25


def check_cube_continuity(path: Path, expectation: str = 'required',
                          min_presence: float = MIN_PRESENCE_FRACTION,
                          max_duplicate: float = MAX_DUPLICATE_FRACTION) -> dict:
    """Fail loudly when a shot breaks the continuity of the cube.

    ``expectation`` says what the script asks of the shot:

    * ``required`` — the cube is in the shot and must be there, exactly
      once, for most of its frames;
    * ``absent`` — the script keeps the cube out of the shot, so a cube
      that shows up in a quarter of the frames is a defect;
    * ``evidence`` — the cube is in the shot but the framing hides it
      (it sits inside the socket of the pedestal in a close-up), so the
      measurement is recorded and no threshold is claimed.

    A second cube is a defect in every expectation: no shot of the film
    may hold two cubes, which is exactly what the creative review of the
    rejected master rejected.
    """
    stats = cube_fractions(Path(path))
    if stats['multiple_fraction'] >= max_duplicate:
        raise ValueError(
            f'{Path(path).name}: a second red cube is visible in '
            f'{stats["multiple_fraction"]:.1%} of {stats["frames"]} frames '
            f'({stats["distribution"]}); the shot shows two cubes and the cube '
            f'continuity of the film is broken.'
        )
    if expectation == 'required' and stats['single_fraction'] < min_presence:
        raise ValueError(
            f'{Path(path).name}: the red cube is visible in only '
            f'{stats["single_fraction"]:.1%} of {stats["frames"]} frames '
            f'({stats["distribution"]}); the script puts the cube in this shot '
            f'and it has to stay there.'
        )
    if expectation == 'absent' and stats['present_fraction'] >= max_duplicate:
        raise ValueError(
            f'{Path(path).name}: a red cube is visible in '
            f'{stats["present_fraction"]:.1%} of {stats["frames"]} frames '
            f'({stats["distribution"]}); the script keeps the cube out of this '
            f'shot.'
        )
    stats['expectation'] = expectation
    stats['verdict'] = 'consistent'
    return stats


def check_cube_count(path: Path, expected: int = 1) -> dict:
    """Measure the cube count and fail loudly when the count is wrong.

    ``expected`` is the number of cubes the script demands in the shot.
    The error message lists the distribution so the failure shows whether
    the object is missing, duplicated or merely misdetected.
    """
    result = analyse(Path(path))
    distribution = result['distribution']
    if result['max_count'] != expected:
        raise ValueError(
            f'{Path(path).name}: expected exactly {expected} red cube(s) but measured '
            f'{distribution}; the cube continuity of the shot is broken.'
        )
    return result


def lamp_bulb_blobs(image, vmin=210, smin=60, hmin=20, hmax=40, minarea=200) -> list[dict]:
    """Return compact yellow/amber *glowing* bulb regions.

    Brown workshop wood occupies the orange hue range below the glow, and
    the old mask selected entire doors/pedestals as the largest "bulb".
    Dark, unlit glass is not measurable with this color detector.
    """
    cv2 = _cv2()
    np = _numpy()
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    mask = ((h >= hmin) & (h <= hmax) & (s >= smin) & (v >= vmin)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, _, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    bulbs = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        box_width = int(stats[label, cv2.CC_STAT_WIDTH])
        box_height = int(stats[label, cv2.CC_STAT_HEIGHT])
        if area < minarea or not box_width or not box_height:
            continue
        aspect = box_width / box_height
        fill = area / (box_width * box_height)
        if not 0.55 <= aspect <= 1.35 or fill < 0.45:
            continue
        bulbs.append({
            'area': area,
            'x': int(stats[label, cv2.CC_STAT_LEFT]),
            'y': int(stats[label, cv2.CC_STAT_TOP]),
            'w': box_width,
            'h': box_height,
            'cx': int(centroids[label][0]),
            'cy': int(centroids[label][1]),
            'fill': round(area / (box_width * box_height), 2),
            'aspect': round(box_width / box_height, 2),
        })
    return sorted(bulbs, key=lambda d: -d['area'])


def bounding_box_gap(box_a: dict, box_b: dict) -> int:
    """Return positive pixel gap between two bounding boxes, or negative value if overlapping."""
    # Horizontal gap: positive if separated, negative if intervals overlap
    x_dist = max(box_a['x'] - (box_b['x'] + box_b['w']), box_b['x'] - (box_a['x'] + box_a['w']))
    # Vertical gap: positive if separated, negative if intervals overlap
    y_dist = max(box_a['y'] - (box_b['y'] + box_b['h']), box_b['y'] - (box_a['y'] + box_a['h']))
    if x_dist > 0 or y_dist > 0:
        return max(x_dist, y_dist)
    # Overlapping in both dimensions
    return max(x_dist, y_dist)


def check_cube_lamp_separation(path: Path, sample: int = 10, min_gap: int = 0, require_pair: bool = False) -> dict:
    """Fail loudly if the cube and the lamp bulb overlap in any sampled frame.

    The creative review rejected the film because the lamp and cube overlapped
    in some scenes. This gate verifies that wherever both are detected, they remain
    spatially separated.
    """
    path = Path(path)
    gaps = []
    overlapping_frames = 0
    sampled_frames = 0
    paired_frames = 0

    for index, frame in _frames(path):
        if index % sample:
            continue
        sampled_frames += 1
        cubes = cube_blobs(frame)
        bulbs = lamp_bulb_blobs(frame)
        if cubes and bulbs:
            paired_frames += 1
            # Check largest cube against largest bulb in the frame
            g = bounding_box_gap(cubes[0], bulbs[0])
            gaps.append(g)
            if g < min_gap:
                overlapping_frames += 1

    if overlapping_frames > 0:
        raise ValueError(
            f"{path.name}: lamp bulb and red cube overlap in {overlapping_frames} of {paired_frames} "
            f"paired frames (min gap: {min(gaps)}px); cube and lamp must remain physically separated."
        )
    if require_pair and not paired_frames:
        raise ValueError(f'{path.name}: cube and glowing lamp are not measurable together; separation is unverified')

    return {
        'path': str(path),
        'sampled_frames': sampled_frames,
        'paired_frames': paired_frames,
        'min_gap': min(gaps) if gaps else None,
        'measurable': bool(paired_frames),
        'verdict': 'separated' if gaps else 'not_measurable',
    }
