"""Measurable ground contact of the robot.

The creative review of the rejected v6 master reported three critical
errors: a scene with two cubes, a robot that changed size along the
film, and a robot that floated between the table and the lamp pedestal.
The cube has ``reference_cube``, the size has ``reference_robot`` and
``reference_continuity``. This module covers the third one.

The robot's light gray body cannot be segmented: it shares its value
range with the wall and with the wooden floor, and no threshold
separates them. What *is* separable is the head, the cyan lenses, and
the shadow the robot casts on the floor. The shadow is the only marker
of the floor plane under the robot, so it is the only thing that says
where the robot touches the ground.

The measurement is the distance from the bottom of the head to the
top of the shadow under the robot, divided by the width of the head:

* a robot standing on the floor casts its shadow at its feet, so the
  distance is the projected length of its own body, a fixed number of
  head widths;
* a robot floating above the floor casts its shadow further down, so
  the distance grows by the height it floats at;
* dividing by the head width makes the number comparable between a
  close-up and a wide shot, which is the whole point: the robot is
  drawn at very different sizes in different shots, and the defect is
  the *height above the floor*, not the size on screen.

The metric is reported as evidence, not as a gate, and the reason is
part of the measurement and not a matter of taste.

Only some shots carry a cast shadow under the robot at all. Measured on
the two films of this project, the render casts a floor shadow under
the robot in 1 of the 12 shots of the new master (S07, coverage 0.68)
and in 4 of the 12 shots of the rejected one (S02 0.15, S04 0.02,
S06 0.26, S07 0.20). In the other shots there is nothing in the frame
that says where the floor is under the robot: the body shares its value
range with the wall, and the only dark band below the head is the
shadowed underside of the head itself. A shot without a shadow is
reported as "not measurable" rather than as a number invented from the
wall behind the robot.

Even where the shadow exists, the metric covers one shot in twelve, so
it cannot carry the acceptance of the film on its own. What it does
give is a number that agrees with the human review where both are
available: in S07, the shot where the rejected master and the new one
share the same script, the robot of the rejected master stands 4.51
head widths above its own shadow and the robot of the new master
stands 2.03, in 23 of the 23 frames where both produce a measurement.

Note that the rejected master has no *measurable* shot by the coverage
rule: its S07 sits at 0.20, below the 0.30 floor. Its 4.51 is an
indicative value, measured on the 24 frames where that film has a
detection and paired with the 23 frames where the new film also has
one. Only the new master's S07 is measurable as a shot. That asymmetry
is itself the evidence that the renders are irregular, and it is the
second reason the metric stays evidence and not a gate.
"""
from __future__ import annotations

from pathlib import Path

from .reference_robot import head_cluster

# The head must be measurable before it can be used as the ruler.
MIN_HEAD_WIDTH = 12
# The shadow is a band of rows that is clearly darker than the lit
# floor around it. The floor of this workshop is lit by a window, so
# the shadow is a strong local darkening, not a subtle one.
SHADOW_VAL_RATIO = 0.72
# A shadow is at least this many rows tall, so a single dark row of
# noise is not read as a shadow.
MIN_SHADOW_ROWS = 2
# A robot whose body is longer than its head cannot be a fraction of a
# head width above its own shadow. The band right under the head is the
# shadowed underside of the head itself, and it is always there, so
# without this floor the metric reads the head's own chin as the
# contact shadow and reports a stand height of a few hundredths of a
# head width. Measured on the two films, the dark band under the head
# sits 0.15-0.35 head widths below it in every shot, and the floor
# shadow of a standing robot sits more than a head width below it.
MIN_STAND_IN_HEAD_WIDTHS = 1.0
# The search below the head covers this many head widths. The body of
# the robot is a couple of head widths long and the shadow sits right
# at its feet, so a window of six head widths reaches the floor and
# stops well before the next piece of furniture.
MAX_SEARCH_IN_HEAD_WIDTHS = 6
# A shot is only reported as measured when enough frames qualify.
MIN_COVERAGE = 0.3
MIN_FRAMES = 4
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}


def _cv2():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - environment guard
        raise RuntimeError('opencv-python is required for the ground metric') from exc
    return cv2


def _numpy():
    import numpy as np
    return np


def _shadow_top(values, baseline: float) -> int | None:
    """Return the first row of the shadow band below the robot.

    The band has to be contiguous and at least ``MIN_SHADOW_ROWS`` rows
    tall, otherwise the first dark row of a textured floor would be
    read as the shadow and the gap would be measured from there.
    """
    dark = [index for index, value in enumerate(values) if value < SHADOW_VAL_RATIO * baseline]
    if not dark:
        return None
    run_start = dark[0]
    length = 1
    for index in dark[1:]:
        if index == run_start + length:
            length += 1
            continue
        break
    if length < MIN_SHADOW_ROWS:
        return None
    return run_start


def contact(frame) -> dict | None:
    """Measure the height of the robot above its own shadow.

    Returns the distance from the bottom of the head to the top of the
    contact shadow, in head widths, or ``None`` when the frame carries
    no usable marker: no head, no shadow, or a shadow so soft that it
    is not distinguishable from the floor.
    """
    np = _numpy()
    head = head_cluster(frame)
    if head is None or head['w'] < MIN_HEAD_WIDTH:
        return None
    cv2 = _cv2()
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    values = hsv[:, :, 2]
    height, width = values.shape
    centre = head['x'] + head['w'] // 2
    left = max(0, centre - head['w'] // 2)
    right = min(width, centre + head['w'] // 2)
    if right - left < 4:
        return None
    start = head['y'] + head['h']
    end = min(height, start + MAX_SEARCH_IN_HEAD_WIDTHS * head['w'])
    if end - start < MIN_SHADOW_ROWS + 1:
        return None
    rows = np.median(values[start:end, left:right], axis=1)
    baseline = float(np.median(rows))
    if baseline <= 0:
        return None
    offset = _shadow_top(rows.tolist(), baseline)
    if offset is None:
        return None
    shadow_top = start + offset
    gap_px = shadow_top - head['y'] - head['h']
    stand = gap_px / head['w']
    if stand < MIN_STAND_IN_HEAD_WIDTHS:
        # This is the underside of the head, not the floor shadow.
        return None
    return {
        'head_width': head['w'],
        'head_bottom': head['y'] + head['h'],
        'shadow_top': shadow_top,
        'floor_value': round(baseline, 1),
        'stand_px': gap_px,
        'stand_head_widths': round(stand, 4),
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
    """Measure the height of the robot above its shadow over a clip."""
    np = _numpy()
    heights: list[float] = []
    frames = 0
    sampled = 0
    for index, frame in _frames(Path(path)):
        frames += 1
        if index % sample:
            continue
        sampled += 1
        measured = contact(frame)
        if measured:
            heights.append(measured['stand_head_widths'])
    if not frames:
        raise ValueError(f'no frames decoded from {path}')
    coverage = len(heights) / max(1, sampled)
    result = {
        'path': str(path),
        'frames': frames,
        'sampled': sampled,
        'detections': len(heights),
        'coverage': round(coverage, 4),
        'stand_head_widths': [round(value, 4) for value in heights],
    }
    result['measurable'] = coverage >= MIN_COVERAGE and len(heights) >= MIN_FRAMES
    result['median_stand_head_widths'] = round(float(np.median(heights)), 4) if heights else None
    # A shot can produce measurements and still not be measurable as a
    # shot, when the shadow is present in too few frames. The numbers
    # exist, but they describe a handful of frames and not the shot, so
    # the artifact says so instead of letting the median be read as if
    # it described the whole clip.
    result['indicative'] = bool(heights) and not result['measurable']
    if result['indicative']:
        result['note'] = (
            'the shadow is detected in %d of %d frames, below the coverage '
            'floor of %.2f: the value describes those frames only and is '
            'indicative, not a measurement of the shot'
            % (len(heights), sampled, MIN_COVERAGE)
        )
    elif not result['measurable']:
        result['note'] = 'no floor shadow under the robot in this shot: nothing to measure'
    return result
