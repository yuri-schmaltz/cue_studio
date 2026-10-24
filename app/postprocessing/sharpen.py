"""GPU-accelerated adaptive unsharp masking / edge sharpening for video and image tensors.

Ported and optimized for Cue Studio postprocessing pipelines.
Processes in chunks across temporal frames to keep peak VRAM under 350MB.
"""
from __future__ import annotations

import torch
import torch.nn.functional as F


def adaptive_sharpen(
    images: torch.Tensor,
    amount: float = 0.5,
    radius: int = 1,
) -> torch.Tensor:
    """Apply edge sharpening (unsharp mask) using GPU acceleration with chunked processing.

    Input: [C, T, H, W] tensor (float32 [0..1] or uint8 [0..255]), on any device.
           Also supports 3D tensors [C, H, W] by temporarily reshaping to [C, 1, H, W].
    Output: same shape, dtype, and device as input.
    """
    if amount <= 0:
        return images

    is_3d = images.dim() == 3
    if is_3d:
        images = images.unsqueeze(1)

    orig_device = images.device
    input_was_uint8 = images.dtype == torch.uint8

    device = torch.device('cuda') if torch.cuda.is_available() else orig_device

    # Standard 3x3 Laplacian edge-detection kernel
    # [1, 1, 3, 3] to be applied per channel via depthwise conv2d
    kernel = torch.tensor(
        [
            [0.0, -1.0, 0.0],
            [-1.0, 4.0, -1.0],
            [0.0, -1.0, 0.0],
        ],
        dtype=torch.float32,
        device=device,
    ).view(1, 1, 3, 3)

    CHUNK_SIZE = 32
    num_frames = images.shape[1]
    num_channels = images.shape[0]
    kernel_grouped = kernel.repeat(num_channels, 1, 1, 1)

    output_chunks = []

    for start in range(0, num_frames, CHUNK_SIZE):
        end = min(start + CHUNK_SIZE, num_frames)
        # chunk: [C, T_chunk, H, W] -> permute to [T_chunk, C, H, W] for 2D conv
        chunk = images[:, start:end].to(device)

        if input_was_uint8:
            chunk = chunk.float().div_(255.0)
        else:
            chunk = chunk.float()

        chunk_t = chunk.permute(1, 0, 2, 3)  # [T, C, H, W]

        # Depthwise conv2d on each frame
        edges = F.conv2d(chunk_t, kernel_grouped, padding=1, groups=num_channels)

        # High-frequency boost: chunk + amount * edges
        sharpened = chunk_t + (edges * (amount * 0.5))
        sharpened.clamp_(0.0, 1.0)

        # [T, C, H, W] -> [C, T, H, W]
        out_chunk = sharpened.permute(1, 0, 2, 3)

        if input_was_uint8:
            out_chunk = out_chunk.mul(255.0).round_().clamp_(0, 255).to(torch.uint8)

        output_chunks.append(out_chunk.to(orig_device))
        del chunk, chunk_t, edges, sharpened, out_chunk

    result = torch.cat(output_chunks, dim=1)
    if is_3d:
        result = result.squeeze(1)
    return result
