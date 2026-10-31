"""Measurable continuity of the robot against the cube it carries.

The creative review of the rejected v6 master reported three critical
errors: a scene with two cubes, a robot that changed size along the
film, and a robot that floated between the table and the lamp pedestal.

The cube count and the lens count have their own modules
(``reference_cube`` and ``reference_identity``). This module covers the
third problem: the *relative* size of the robot.

The apparent size of a robot in two different shots is not comparable --
a close-up is supposed to show a bigger robot than a wide shot. What
*is* comparable is the robot measured against an object that is always
in the same shot and at the same distance from the camera: the red cube
it holds in its right hand. The head width divided by the cube width
is therefore a scale ruler that survives the change of shot size, and
it is the only one available: the robot's light gray body cannot be
segmented from the wall, and the table and the pedestal move in the
frame.

The ruler is only applied where it is physically valid, that is, where
the robot holds the cube in the frame. In the other shots the cube
sits on the table or in the pedestal socket, at another distance from
the camera, and the ratio would measure the camera instead of the
robot.

The measurement is also robust against the two extremes of a shot. The
creative review of the rejected v6 master reported a robot that changed
size along the film, and the ruler of that master measured a maximum
and a minimum that differ by a factor of 1.65 in a shot where the
tenth and ninetieth percentiles differ by a factor of 1.09: the
extreme frames of a shot carry the noise of a head that is half hidden
by an arm or blurred by motion, and the percentiles carry the size.
The band is therefore checked against the median and the spread is
measured between the tenth and the ninetieth percentile.

Because the ruler is comparable between shots, it also measures the
size of the robot *along* the film: the head and the cube are rigid, so
a robot that keeps one size keeps the ratio in every shot where it
holds the cube. The rejected master spread its ruler by a factor of
1.70 between its shots, which is the size error the creative review
rejected; the corrected render keeps the same shots within a factor of
1.08.
"""
from __future__ import annotations

from pathlib import Path

from .reference_cube import cube_blobs
from .reference_robot import MAX_DRIFT, head_cluster

# The robot is described as knee-high and the cube as fist-sized, so the
# head is clearly wider than the cube. The band is therefore a sanity
# check on the drawing, not the main gate: a head narrower than the
# cube it carries is not a small robot, it is a wrong robot.
MIN_HEAD_TO_CUBE = 1.0
MAX_HEAD_TO_CUBE = 3.5
# A frame only counts when the cube is large enough to measure its width
# and the head is large enough to measure too.
MIN_CUBE_WIDTH = 20
MIN_HEAD_WIDTH = 12
# At least this many qualifying frames are needed for a shot to be
# measured; below it the ratio is noise.
MIN_FRAMES = 4
# The ratio may not wander by more than this factor inside one shot. The
# spread is measured between the tenth and the ninetieth percentile: the
# extremes of a shot carry the noise of a head that is half hidden by an
# arm or blurred by motion, while the percentiles carry the size.
MAX_SPREAD = 1.35
# The robot keeps one size along the whole film. Because the head and
# the cube are both rigid and the ruler is only applied where the robot
# holds the cube, the ratio has to be the same in every such shot: a
# robot that grows or shrinks along the film moves this number.
#
# This is the measurement behind the creative review that rejected the
# v6 master for "a robot of different sizes along the video". Measured
# on the rejected master, the ruler spread between its shots by a factor
# of 1.70 (0.91 in S07 against 1.55 in S04); the corrected render keeps
# the same shots within a factor of 1.08. The factor below sits between
# the two, with room on both sides.
MAX_CROSS_SHOT_RATIO = 1.25


def _cv2():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - environment guard
        raise RuntimeError('opencv-python is required for the continuity metric') from exc
    return cv2


def _numpy():
    import numpy as np
    return np


def head_to_cube_ratio(image) -> float | None:
    """Return the head width over the cube width of one frame.

    The frame only qualifies when exactly one cube is visible: with two
    cubes it is not known which one the robot is holding, and the ratio
    would be meaningless.
    """
    head = head_cluster(image)
    if head is None or head['w'] < MIN_HEAD_WIDTH:
        return None
    cubes = cube_blobs(image)
    if len(cubes) != 1:
        return None
    cube = cubes[0]
    if cube['w'] < MIN_CUBE_WIDTH:
        return None
    return head['w'] / cube['w']


def _frames(path: Path):
    cv2 = _cv2()
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


def analyse(path: Path, sample: int = 4) -> dict:
    """Measure the robot's size against the cube over a clip."""
    np = _numpy()
    ratios: list[float] = []
    for index, frame in _frames(Path(path)):
        if index % sample:
            continue
        ratio = head_to_cube_ratio(frame)
        if ratio is not None:
            ratios.append(ratio)
    result = {
        'path': str(path),
        'frames_measured': len(ratios),
        'ratios': [round(ratio, 4) for ratio in ratios],
    }
    if len(ratios) < MIN_FRAMES:
        result['measurable'] = False
        result['median_ratio'] = None
        result['p10_ratio'] = None
        result['p90_ratio'] = None
        result['spread'] = None
        result['extremes'] = None
        return result
    values = np.array(ratios)
    result['measurable'] = True
    result['median_ratio'] = round(float(np.median(values)), 4)
    result['p10_ratio'] = round(float(np.percentile(values, 10)), 4)
    result['p90_ratio'] = round(float(np.percentile(values, 90)), 4)
    result['spread'] = round(
        float(np.percentile(values, 90) / np.percentile(values, 10)), 4)
    result['extremes'] = round(float(np.max(values) / np.min(values)), 4)
    return result


def check_relative_scale(path: Path, min_ratio: float = MIN_HEAD_TO_CUBE,
                         max_ratio: float = MAX_HEAD_TO_CUBE,
                         max_spread: float = MAX_SPREAD) -> dict:
    """Fail loudly when the robot is not the right size for its cube.

    A shot whose ruler is not measurable is reported as evidence only:
    in a wide shot the robot and the cube are a few pixels wide and
    refusing to measure is more honest than reporting a made-up number.
    """
    result = analyse(Path(path))
    if not result['measurable']:
        result['verdict'] = 'not-measurable'
        return result
    ratio = result['median_ratio']
    spread = result['spread']
    if ratio < min_ratio or ratio > max_ratio:
        result['verdict'] = 'wrong-size'
        raise ValueError(
            f'{Path(path).name}: the robot is {ratio:.2f} cube widths wide, outside '
            f'[{min_ratio}, {max_ratio}]; the robot must keep the same size relative '
            f'to the cube it carries.'
        )
    if spread > max_spread:
        result['verdict'] = 'unstable'
        raise ValueError(
            f'{Path(path).name}: the robot changes size inside the shot against the '
            f'cube (ratio spread {spread}); the robot must keep one size in every shot.'
        )
    result['verdict'] = 'stable'
    return result


def check_scale_consistency(measurements: dict[str, dict],
                            max_ratio: float = MAX_CROSS_SHOT_RATIO,
                            required_shots: set[str] | list[str] | None = None,
                            min_measured_shots: int = 2) -> dict:
    """Fail loudly when the robot changes size between shots or when required shots are unmeasurable.

    ``measurements`` maps a shot id to the result of ``analyse`` on its
    clip. Only the shots whose ruler was measurable take part: a shot
    where the head could not be measured says nothing about the size of
    the robot.
    """
    measured = {shot: result['median_ratio'] for shot, result in measurements.items()
                if result.get('measurable') and result.get('median_ratio') is not None}
    if required_shots:
        missing = [s for s in required_shots if s not in measured]
        if missing:
            raise ValueError(
                f"Required scale consistency shots not measurable: {', '.join(sorted(missing))}; "
                f"the robot head and cube must be measurable to verify scale consistency."
            )
    if len(measured) < min_measured_shots:
        return {'verdict': 'not-measurable', 'shots': measured}
    smallest = min(measured, key=measured.get)
    largest = max(measured, key=measured.get)
    spread = measured[largest] / measured[smallest]
    result = {
        'verdict': 'consistent' if spread <= max_ratio else 'inconsistent',
        'shots': measured,
        'smallest': smallest,
        'largest': largest,
        'spread': round(spread, 4),
        'max_ratio': max_ratio,
    }
    if spread > max_ratio:
        raise ValueError(
            f'The robot changes size along the film: it measures '
            f'{measured[smallest]:.2f} cube widths wide in {smallest} and '
            f'{measured[largest]:.2f} in {largest}, a factor of {spread:.2f} '
            f'(limit {max_ratio}); the robot must keep one size in every shot.')
    return result


def check_lateral_carry_keyframes(paths, direction='right', min_travel_fraction=0.3,
                                  max_step_fraction=0.25, min_step_fraction=0.03):
    """A transport cannot be static poses followed by a jump at the ending."""
    if direction not in {'right', 'left'} or len(paths) < 3:
        raise ValueError('A lateral carry requires a direction and at least three states')
    limits = (min_travel_fraction, max_step_fraction, min_step_fraction)
    if any(type(value) not in (int, float) or not 0 <= value <= 1 for value in limits):
        raise ValueError('Lateral motion limits must be fractions in [0, 1]')
    cv2 = _cv2()
    states = []
    shape = None
    for path in paths:
        image = cv2.imread(str(path))
        if image is None or (shape is not None and image.shape != shape):
            raise ValueError(f'{Path(path).name}: carry states need matching image dimensions')
        shape = image.shape
        head = head_cluster(image)
        cubes = cube_blobs(image)
        if head is None or head['lenses'] != 3 or len(cubes) != 1:
            raise ValueError(f'{Path(path).name}: carry state needs a measurable three-lens head and one cube')
        cube = cubes[0]
        cx, cy = head['x'] + head['w'] / 2, head['y'] + head['h'] / 2
        states.append({'path': str(path), 'head_x': cx, 'head_width': head['w'],
                       'cube_x': cube['cx'], 'offset_x': (cube['cx'] - cx) / head['w'],
                       'offset_y': (cube['cy'] - cy) / head['w']})
    sign = 1 if direction == 'right' else -1
    width = shape[1]
    steps = [sign * (b['head_x'] - a['head_x']) / width for a, b in zip(states, states[1:])]
    travel = sign * (states[-1]['head_x'] - states[0]['head_x']) / width
    if travel < min_travel_fraction:
        raise ValueError('Carry keyframes do not complete the lateral journey')
    if any(step < min_step_fraction for step in steps[:-1]):
        raise ValueError('Carry keyframes stall or reverse before the endpoint')
    if steps[-1] < -0.01 or any(step > max_step_fraction for step in steps):
        raise ValueError('Carry keyframes jump or reverse instead of progressing across the room')
    if max(state['head_width'] for state in states) / min(state['head_width'] for state in states) > MAX_DRIFT:
        raise ValueError('Carry keyframes change robot scale')
    if any(max(state[key] for state in states) - min(state[key] for state in states) > 1
           for key in ('offset_x', 'offset_y')):
        raise ValueError('The cube changes its held relationship to the robot across carry states')
    return {'verdict': 'progressing', 'direction': direction, 'travel_fraction': travel,
            'step_fractions': steps, 'states': states}
