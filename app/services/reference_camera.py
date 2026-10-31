"""Measure a declared fixed camera from robust background feature matches."""
import math
from pathlib import Path


def check_fixed_camera(path: Path, sample=8, max_scale_drift=0.05,
                       max_translation_fraction=0.025, max_rotation_degrees=2):
    import cv2
    import numpy as np
    from .reference_robot import head_cluster

    cap = cv2.VideoCapture(str(path))
    rows = []
    try:
        ok, first = cap.read()
        if not ok:
            raise ValueError(f'{path.name}: fixed camera has no readable picture')
        height, width = first.shape[:2]
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        orb = cv2.ORB_create(nfeatures=1800)
        # Do not let the known foreground robot define the camera. A close-up
        # with no independent background must remain unmeasurable.
        mask = None
        head = head_cluster(first)
        if head is not None:
            mask = np.full((height, width), 255, dtype=np.uint8)
            x0 = max(0, head['x'] - head['w'])
            x1 = min(width, head['x'] + 2 * head['w'])
            y0 = max(0, head['y'] - head['h'])
            y1 = min(height, head['y'] + 6 * head['h'])
            mask[y0:y1, x0:x1] = 0
        keys, descriptors = orb.detectAndCompute(first, mask)
        if descriptors is None or len(keys) < 20:
            raise ValueError(f'{path.name}: fixed-camera background is not measurable')
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        index = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            index += 1
            if index % sample and index != count - 1:
                continue
            current_keys, current_descriptors = orb.detectAndCompute(frame, None)
            if current_descriptors is None or len(current_keys) < 2:
                raise ValueError(f'{path.name}: camera is not measurable at frame {index}')
            pairs = matcher.knnMatch(descriptors, current_descriptors, k=2)
            matches = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < 0.7 * pair[1].distance]
            if len(matches) < 20:
                raise ValueError(f'{path.name}: insufficient background matches at frame {index}')
            source = np.float32([keys[match.queryIdx].pt for match in matches])
            target = np.float32([current_keys[match.trainIdx].pt for match in matches])
            transform, inliers = cv2.estimateAffinePartial2D(
                source, target, method=cv2.RANSAC, ransacReprojThreshold=3)
            if transform is None or int(inliers.sum()) < 12 or float(inliers.mean()) < 0.3:
                raise ValueError(f'{path.name}: background transform is not measurable at frame {index}')
            scale = math.hypot(transform[0, 0], transform[1, 0])
            rotation = math.degrees(math.atan2(transform[1, 0], transform[0, 0]))
            translation = max(abs(transform[0, 2]) / width, abs(transform[1, 2]) / height)
            rows.append({'frame': index, 'scale': scale, 'rotation_degrees': rotation,
                         'translation_fraction': translation, 'inliers': int(inliers.sum())})
    finally:
        cap.release()
    if not rows:
        raise ValueError(f'{path.name}: no camera movement samples were measurable')
    scale_drift = max(abs(row['scale'] - 1) for row in rows)
    translation = max(row['translation_fraction'] for row in rows)
    rotation = max(abs(row['rotation_degrees']) for row in rows)
    if scale_drift > max_scale_drift or translation > max_translation_fraction or rotation > max_rotation_degrees:
        raise ValueError(f'{path.name}: fixed camera changed; scale drift={scale_drift:.4f}, '
                         f'translation fraction={translation:.4f}, rotation={rotation:.3f} degrees')
    return {'verdict': 'fixed', 'max_scale_drift': scale_drift,
            'max_translation_fraction': translation, 'max_rotation_degrees': rotation, 'samples': rows}
