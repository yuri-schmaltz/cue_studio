import shutil
import subprocess

import pytest

from app.services.reference_camera import check_fixed_camera

cv2 = pytest.importorskip('cv2')
np = pytest.importorskip('numpy')


def clip(tmp_path, movement):
    if not all(shutil.which(tool) for tool in ('ffmpeg', 'ffprobe')):
        pytest.skip('FFmpeg required')
    rng = np.random.default_rng(42)
    background = rng.integers(30, 220, (192, 320, 3), dtype=np.uint8)
    for i in range(9):
        image = background.copy() if movement != 'unmeasurable' else np.full_like(background, 160)
        if movement != 'unmeasurable':
            # A moving actor is not camera movement: background remains fixed.
            x = 10 + i * 15
            cv2.rectangle(image, (x, 80), (x + 35, 150), (180, 180, 180), -1)
            if movement == 'zoom':
                image = cv2.warpAffine(image, cv2.getRotationMatrix2D((160, 96), 0, 1 + i * .025), (320, 192))
            elif movement == 'pan':
                image = cv2.warpAffine(image, np.float32([[1, 0, i * 2], [0, 1, 0]]), (320, 192))
        cv2.imwrite(str(tmp_path / f'{i:03d}.png'), image)
    path = tmp_path / 'camera.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-framerate', '25', '-i', str(tmp_path / '%03d.png'),
                    '-c:v', 'libx264', '-crf', '15', '-pix_fmt', 'yuv420p', str(path)], check=True)
    return path


def test_background_camera_stays_fixed_while_foreground_actor_moves(tmp_path):
    result = check_fixed_camera(clip(tmp_path, 'fixed'), sample=1)
    assert result['verdict'] == 'fixed'
    assert result['max_scale_drift'] < .01
    assert len(result['samples']) == 8


@pytest.mark.parametrize('movement', ['zoom', 'pan'])
def test_real_camera_transform_is_rejected(tmp_path, movement):
    with pytest.raises(ValueError, match='fixed camera changed'):
        check_fixed_camera(clip(tmp_path, movement), sample=1)


def test_missing_background_measurement_never_becomes_approval(tmp_path):
    with pytest.raises(ValueError, match='not measurable'):
        check_fixed_camera(clip(tmp_path, 'unmeasurable'), sample=1)
