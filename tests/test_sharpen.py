from __future__ import annotations

import torch
import pytest

from app.postprocessing.sharpen import adaptive_sharpen


def test_sharpen_preserves_shape_and_dtype_uint8():
    # [C, T, H, W]
    images = torch.randint(0, 256, (3, 10, 64, 64), dtype=torch.uint8)
    sharpened = adaptive_sharpen(images, amount=0.5)

    assert sharpened.shape == images.shape
    assert sharpened.dtype == torch.uint8
    assert sharpened.min() >= 0
    assert sharpened.max() <= 255


def test_sharpen_preserves_shape_and_dtype_float32():
    images = torch.rand((3, 5, 32, 32), dtype=torch.float32)
    sharpened = adaptive_sharpen(images, amount=0.8)

    assert sharpened.shape == images.shape
    assert sharpened.dtype == torch.float32
    assert sharpened.min() >= 0.0
    assert sharpened.max() <= 1.0


def test_sharpen_3d_single_frame():
    images = torch.randint(0, 256, (3, 48, 48), dtype=torch.uint8)
    sharpened = adaptive_sharpen(images, amount=0.4)

    assert sharpened.shape == (3, 48, 48)
    assert sharpened.dtype == torch.uint8


def test_sharpen_zero_amount_is_noop():
    images = torch.randint(0, 256, (3, 4, 32, 32), dtype=torch.uint8)
    out = adaptive_sharpen(images, amount=0.0)
    assert torch.equal(out, images)


def test_sharpen_increases_edge_contrast():
    # Create an image with a blurry transition in the middle
    # Left side: 0.2, Middle: 0.5, Right side: 0.8
    img = torch.full((1, 1, 16, 16), 0.5, dtype=torch.float32)
    img[:, :, :, :6] = 0.2
    img[:, :, :, 10:] = 0.8

    sharpened = adaptive_sharpen(img, amount=0.8)

    # Edge enhancement should overshoot/undershoot slightly at borders to increase acutance:
    # Near the transition: lower value on the dark side of edge, higher value on bright side
    assert sharpened[:, :, :, 5].mean() <= img[:, :, :, 5].mean()
    assert sharpened[:, :, :, 10].mean() >= img[:, :, :, 10].mean()
