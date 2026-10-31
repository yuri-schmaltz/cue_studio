from app.services.runtime_frames import (
    align_model_frame_count, compute_next_sliding_window_length,
    compute_sliding_window_no, normalize_model_total_frame_count,
    resolve_window_position_token,
)


def test_native_boundary_does_not_accidentally_split_a_single_window():
    model = {'latent_size': 8}
    assert align_model_frame_count(128, model) == 121
    assert align_model_frame_count(128, model, for_generation=True) == 129
    assert compute_sliding_window_no(137, 129, 8, 9) == 2
    assert compute_sliding_window_no(137, 145, 8, 9) == 1


def test_exact_long_timeline_is_not_confused_with_bounded_native_pass():
    model = {'frames_minimum': 124, 'frames_maximum': 345,
             'frame_alignment_modulus': 17, 'frame_alignment_remainder': 5,
             'sliding_window_exact_total_frames': True}
    assert normalize_model_total_frame_count(470, model) == 470
    assert align_model_frame_count(470, model) == 345
    # Regression: a 124-frame 1080p pass must not grow to 226 in pass two.
    assert compute_next_sliding_window_length(226, 124, 17, model) == 124
    assert compute_next_sliding_window_length(1000, 124, 17, model) == 124


def test_nonbounded_model_continuation_stays_within_explicit_window():
    assert compute_next_sliding_window_length(500, 129, 8, {}) == 129
    assert compute_next_sliding_window_length(80, 129, 8, {}) == 81


def test_injected_positions_follow_fresh_window_spans_without_overlap_or_discard():
    def resolve(token, source=0, overlap=0):
        return resolve_window_position_token(token, 129, 129, 8, 9, source, overlap, 350)

    assert resolve('W1:100') == 120
    assert resolve('W2:0') == 121
    assert resolve('W2:100') == 232
    assert resolve('W3:0') == 233
    assert resolve('W99:100') == 349
    assert resolve('W1:0', source=50, overlap=9) == 50
    assert resolve('25') is None
