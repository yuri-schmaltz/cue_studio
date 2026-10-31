"""Pure temporal-grid and sliding-window calculations for the runtime."""
import math
import re

_WINDOW_POSITION_TOKEN_RE = re.compile(r"^[Ww](\d+):(\d{1,3})$")


def compute_sliding_window_no(current_video_length, sliding_window_size, discard_last_frames, reuse_frames):
    left_after_first_window = current_video_length - sliding_window_size + discard_last_frames
    return 1 + math.ceil(left_after_first_window / (sliding_window_size - discard_last_frames - reuse_frames))

def align_model_frame_count(
    frame_count,
    model_def,
    for_generation=False,
    clamp_maximum=True,
):
    """Align a requested frame count to a model's native temporal grid."""
    frame_count = int(frame_count)
    modulus = int(model_def.get("frame_alignment_modulus", 0) or 0)
    if modulus > 0:
        remainder = int(model_def.get("frame_alignment_remainder", 1)) % modulus
        minimum = int(model_def.get("frames_minimum", 1))
        maximum = (
            model_def.get("frames_maximum", None)
            if clamp_maximum
            else None
        )
        frame_count = max(minimum, frame_count)
        if maximum is not None:
            frame_count = min(int(maximum), frame_count)

        delta = (frame_count - remainder) % modulus
        mode = str(model_def.get("frame_alignment_mode", "floor")).lower()
        if delta:
            if mode == "ceil":
                frame_count += modulus - delta
            elif mode == "nearest":
                frame_count += modulus - delta if delta >= modulus / 2 else -delta
            else:
                frame_count -= delta

        if maximum is not None and frame_count > int(maximum):
            frame_count -= modulus
        if frame_count < minimum:
            frame_count += modulus
        return frame_count

    latent_size = int(model_def.get("latent_size", model_def.get("frames_steps", 4)))
    if for_generation:
        return (frame_count // latent_size) * latent_size + 1
    return (frame_count - 1) // latent_size * latent_size + 1

def normalize_model_total_frame_count(frame_count, model_def):
    """Normalize an output timeline without treating a window cap as total."""

    frame_count = int(frame_count)
    maximum = model_def.get("frames_maximum", None)
    if (
        model_def.get("sliding_window_exact_total_frames", False)
        and maximum is not None
        and frame_count > int(maximum)
    ):
        return max(int(model_def.get("frames_minimum", 1)), frame_count)
    return align_model_frame_count(frame_count, model_def)

def compute_next_sliding_window_length(
    remaining_with_context,
    sliding_window_size,
    latent_size,
    model_def,
):
    """Size a continuation pass without ever exceeding its window cap.

    Models such as MiniMax H3 keep the requested joined duration exact while
    requiring every individual pass to land on a model-native frame grid.  A
    previous exact-duration branch aligned the *entire remaining timeline*
    but forgot to reapply ``sliding_window_size``.  The first 1080p H3 pass
    could therefore use the intended 124 frames while pass two silently grew
    to 226 frames and exhausted VRAM.
    """

    if model_def.get("sliding_window_exact_total_frames", False):
        candidate = align_model_frame_count(
            remaining_with_context,
            model_def,
            for_generation=True,
        )
    else:
        candidate = (remaining_with_context // latent_size) * latent_size + 1
    return min(int(sliding_window_size), int(candidate))


def resolve_window_position_token(
    token,
    first_window_length,
    sliding_window_size,
    discard_last_frames,
    reuse_frames,
    source_video_frames_count,
    source_video_overlap_frames_count,
    total_frames,
):
    """Resolve a Maestro window-relative injected-frame token to an absolute frame.

    Token form: "W<k>:<pct>" — window number k (1-based) and a percent
    0..100 into that window's FRESH span (after the reused overlap prefix,
    before the discarded tail). "W2:100" = the last kept frame window 2
    contributes to the output; "W3:0" = window 3's first fresh frame.

    Why this exists: the frontend can only approximate window boundaries
    (seconds-space math vs the backend's quantized frame layout), and the
    error grows with the window index. A numeric position computed for
    "end of window 3" can drift past the real boundary into window 4's
    fresh region (the injection then plays like the first frame of the
    next window) or into an overlap/discard zone (it never shows at all).
    Symbolic tokens let the backend place the frame against its OWN
    layout, exactly. Mirrors the iterative arithmetic of the native "L"
    branch in generate_video (first window advances by its own length,
    later windows by sliding_window_size - discard - reuse), including
    the final-window clamp.

    Returns the absolute 0-based frame index (source video included), or
    None when the token isn't a W-token (caller falls through to the
    legacy numeric/L parsing). Window numbers past the final window clamp
    to the final window.
    """
    match = _WINDOW_POSITION_TOKEN_RE.match(str(token).strip())
    if match is None:
        return None
    target_window = max(1, int(match.group(1)))
    pct = min(100, int(match.group(2)))

    base = source_video_frames_count - source_video_overlap_frames_count
    # First fresh frame of window 1: with a source video, the generation
    # re-covers the source's overlap tail, so new visible content starts
    # right after the FULL source; without one, frame 0.
    fresh_start = source_video_frames_count
    end = base - 1 + first_window_length
    window_no = 1
    is_final = end >= total_frames - 1
    while window_no < target_window and not is_final:
        fresh_start = end - discard_last_frames + 1
        end = end - discard_last_frames - reuse_frames + sliding_window_size
        window_no += 1
        is_final = end >= total_frames - 1
    if is_final:
        end = min(end, total_frames - 1)
    kept_end = end if is_final else end - discard_last_frames
    kept_end = max(kept_end, fresh_start)
    pos = fresh_start + int(round((kept_end - fresh_start) * pct / 100.0))
    return max(0, min(pos, total_frames - 1))
