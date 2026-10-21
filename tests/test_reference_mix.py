"""The reference film's mix must keep the narration above the music bed.

A loud bed at -13.7 LUFS against narration at -25.8 LUFS buries the voice
even though the programme as a whole measures a correct -16 LUFS. These
tests pin the level policy and the acceptance margin that keeps the
narration audible.
"""
import math
from pathlib import Path
import wave

import pytest

from app.services.reference_acceptance import run_media
from app.services.reference_mix import (
    EFFECT_PEAK_DBFS, MIN_SPEECH_MARGIN_DB, MUSIC_LUFS, PROGRAMME_LUFS,
    SPEECH_LUFS, Stem, level_stems, measure, mix_stems, narration_margin_db, window_loudness,
)

SAMPLES = 48000 * 4
# The voice occupies the first two seconds; the bed runs over the whole file.
SPEECH_WINDOW = (0.5, 1.0)
BED_WINDOW = (2.5, 1.0)


def _tone(path: Path, frequency: float, duration: float, volume: float) -> Path:
    """A steady tone, used as a stand-in for a stem of a given level."""
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        f'sine=frequency={frequency}:sample_rate=48000:duration={duration}',
        '-af', f'volume={volume}dB', '-ac', '2', '-c:a', 'pcm_s16le', str(path),
    ])
    return path


@pytest.fixture
def stems(tmp_path):
    """A bed far louder than the narration, which is what went wrong."""
    bed = _tone(tmp_path / 'music.wav', 220, 4, -6)
    voice = _tone(tmp_path / 'voice.wav', 440, 2, -22)
    effect = _tone(tmp_path / 'effect.wav', 880, 1, -14)
    return [
        Stem(voice, 'speech'),
        Stem(bed, 'music'),
        Stem(effect, 'effect', weight=0.5),
    ]


def test_naive_sum_buries_the_narration(stems, tmp_path):
    """The defect must be reproducible, or the fix cannot be trusted."""
    bed, voice = stems[1].path, stems[0].path
    naive = tmp_path / 'naive.wav'
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-i', str(bed), '-i', str(voice),
        '-filter_complex', 'amix=inputs=2:duration=longest,loudnorm=I=-16:TP=-2.5:LRA=11',
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(naive),
    ])
    margin = narration_margin_db(naive, SPEECH_WINDOW, BED_WINDOW)
    assert margin < MIN_SPEECH_MARGIN_DB


def test_policy_lifts_the_narration_above_the_bed(stems, tmp_path):
    leveled = level_stems(stems, tmp_path / 'leveled')
    mix = tmp_path / 'mix.wav'
    report = mix_stems(leveled, mix)
    assert abs(report['loudness_lufs'] - PROGRAMME_LUFS) <= 1
    assert report['true_peak_dbtp'] <= -1
    margin = narration_margin_db(mix, SPEECH_WINDOW, BED_WINDOW)
    assert margin >= MIN_SPEECH_MARGIN_DB


def test_each_role_reaches_its_own_anchor(stems, tmp_path):
    leveled = level_stems(stems, tmp_path / 'leveled')
    assert abs(float(measure(leveled[0])['input_i']) - SPEECH_LUFS) <= 0.5
    assert abs(float(measure(leveled[1])['input_i']) - MUSIC_LUFS) <= 0.5
    assert abs(float(measure(leveled[2])['input_tp']) - (EFFECT_PEAK_DBFS + 20 * math.log10(0.5))) <= 0.5


def test_mix_measures_the_programme_it_produced(stems, tmp_path):
    leveled = level_stems(stems, tmp_path / 'leveled')
    mix = tmp_path / 'mix.wav'
    report = mix_stems(leveled, mix)
    measured = measure(mix)
    assert float(measured['input_i']) == pytest.approx(report['loudness_lufs'], abs=0.1)
    assert float(measured['input_tp']) == pytest.approx(report['true_peak_dbtp'], abs=0.1)


def test_mix_can_be_trimmed_to_an_exact_sample_count(stems, tmp_path):
    leveled = level_stems(stems, tmp_path / 'leveled')
    mix = tmp_path / 'mix.wav'
    mix_stems(leveled, mix, samples=SAMPLES)
    with wave.open(str(mix), 'rb') as audio:
        assert audio.getnframes() == SAMPLES
        assert audio.getframerate() == 48000
        assert audio.getnchannels() == 2


def test_the_programme_gain_does_not_re_equalise_the_narration(tmp_path):
    """Reaching the programme loudness must not re-equalise the mix.

    The defect this pins: the programme target was reached with a filter
    that re-equalises quiet passages, which pulls the bed up over the
    narration and buries the voice. One static gain leaves the balance the
    levels established untouched, so the difference between two windows of
    the mix must be the difference between the same two windows of the
    summed stems.
    """
    # A bed whose level changes over time gives the programme a loudness
    # range wider than the target, which is what makes a loudness filter
    # reach for its dynamic mode instead of a static gain.
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        'sine=frequency=220:sample_rate=48000:duration=20',
        '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=40',
        '-filter_complex', '[0:a]volume=-10dB[a];[1:a]volume=-25dB[b];[a][b]concat=n=2:v=0:a=1',
        '-ac', '2', '-c:a', 'pcm_s16le', str(tmp_path / 'bed.wav'),
    ])
    voice = _tone(tmp_path / 'voice.wav', 440, 2, 0)
    leveled = level_stems([Stem(voice, 'speech'), Stem(tmp_path / 'bed.wav', 'music')],
                          tmp_path / 'leveled')
    summed = tmp_path / 'sum.wav'
    inputs = [argument for path in leveled for argument in ('-i', str(path))]
    run_media([
        'ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex',
        f'amix=inputs={len(leveled)}:duration=longest:normalize=0',
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', str(summed),
    ])
    mix = tmp_path / 'mix.wav'
    mix_stems(leveled, mix, samples=48000 * 60)
    before = window_loudness(summed, 0.5, 1.0) - window_loudness(summed, 4.0, 2.0)
    after = window_loudness(mix, 0.5, 1.0) - window_loudness(mix, 4.0, 2.0)
    assert abs(after - before) <= 1.0, (
        f"the programme gain re-equalised the mix: {before:.2f} dB became {after:.2f} dB")


def test_unknown_role_is_rejected(tmp_path):
    tone = _tone(tmp_path / 'x.wav', 440, 1, -10)
    with pytest.raises(ValueError, match='Unknown stem role'):
        level_stems([Stem(tone, 'soundtrack')], tmp_path / 'leveled')


def test_silent_stem_cannot_be_leveled(tmp_path):
    silent = tmp_path / 'silent.wav'
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        'anullsrc=r=48000:cl=stereo:d=1', '-c:a', 'pcm_s16le', str(silent),
    ])
    with pytest.raises(ValueError, match='no measurable level'):
        level_stems([Stem(silent, 'speech')], tmp_path / 'leveled')


def test_a_mix_needs_at_least_one_stem(tmp_path):
    with pytest.raises(ValueError, match='at least one stem'):
        mix_stems([], tmp_path / 'mix.wav')