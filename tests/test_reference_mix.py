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
    AMBIENT_LOOP_LEVEL_TOLERANCE_DB, EFFECT_PEAK_DBFS, MIN_SPEECH_MARGIN_DB,
    MUSIC_LUFS, PROGRAMME_LUFS, SPEECH_LUFS, Stem, build_seamless_loop,
    check_bed_continuity, check_music_coverage, level_stems, measure,
    mix_stems, narration_margin_db, window_loudness,
)
from app.services.reference_mix import _envelope_db

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


def _room_tone(path: Path, seconds: float, level_db: float = -18.0) -> Path:
    """A steady bed, used to stand in for a generated room tone."""
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        f'sine=frequency=180:sample_rate=48000:duration={seconds}',
        '-af', f'volume={level_db}dB', '-ac', '2', '-c:a', 'pcm_s16le', str(path),
    ])
    return path


def test_a_bed_that_loops_without_a_gap_is_accepted(tmp_path):
    """The bed of the film must hold its level from the first to the last second."""
    bed = _room_tone(tmp_path / 'bed.wav', 60)
    evidence = check_bed_continuity(bed)
    assert evidence['worst_hole_seconds'] == 0


def test_a_bed_with_a_gap_is_rejected(tmp_path):
    """The defect the v9 film carried: the room tone dropped out mid-film.

    The take of a generated bed opens with digital silence, and repeating
    it as it is repeats that silence at every cycle. A bed that dips below
    its own median for a tenth of a second is a hole the listener hears.
    """
    bed = tmp_path / 'bed.wav'
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        'sine=frequency=180:sample_rate=48000:duration=30',
        '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=48000:duration=30',
        '-filter_complex',
        '[0:a]volume=-18dB[a];[1:a]volume=-18dB,volume=enable=\'between(t,20,20.3)\':volume=0[b];'
        '[a][b]concat=n=2:v=0:a=1',
        '-ac', '2', '-c:a', 'pcm_s16le', str(bed),
    ])
    with pytest.raises(ValueError, match='below its median'):
        check_bed_continuity(bed)


def test_a_music_that_dies_before_the_end_is_rejected(tmp_path):
    """The music generator stops writing new music before the duration it was given.

    The last seconds of the film would then be played over a frozen,
    silent track, which is what the v9 film shipped.
    """
    music = tmp_path / 'music.wav'
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        'sine=frequency=220:sample_rate=48000:duration=57',
        '-f', 'lavfi', '-i',
        'sine=frequency=220:sample_rate=48000:duration=3',
        '-filter_complex',
        '[0:a]volume=-16dB[a];[1:a]volume=-60dB[b];[a][b]concat=n=2:v=0:a=1',
        '-ac', '2', '-c:a', 'pcm_s16le', str(music),
    ])
    with pytest.raises(ValueError, match='dies before the picture ends'):
        check_music_coverage(music)


def test_a_music_that_plays_to_the_end_is_accepted(tmp_path):
    music = _room_tone(tmp_path / 'music.wav', 60, -16)
    evidence = check_music_coverage(music)
    assert evidence['tail_drop_db'] <= 12


def _generated_take(path: Path) -> Path:
    """A stand-in for a generated room tone: silence, then a swell to its level.

    This is the shape the generator's take actually has, and the shape that
    made the repeated bed hole: the first tenth of a second is silent and
    the level climbs for another second and a half.
    """
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        'sine=frequency=180:sample_rate=48000:duration=5',
        '-af', 'volume=-18dB,afade=t=in:st=0:d=1.5,'
               'volume=enable=\'between(t,0,0.12)\':volume=0',
        '-ac', '2', '-c:a', 'pcm_s16le', str(path),
    ])
    return path


def test_the_bed_cycle_drops_the_silence_the_generator_opens_with(tmp_path):
    """The cycle must start where the take is steady, not in its silence.

    A generated take opens with a tenth of a second of digital silence and
    then swells up to its level. A cycle built from the whole take repeats
    that silence at every cycle, which is the hole the film carried.
    """
    take = _generated_take(tmp_path / 'take.wav')
    cycle = tmp_path / 'cycle.wav'
    evidence = build_seamless_loop(take, cycle)
    # The silence and the swell are behind the cycle: what is kept is the
    # stretch that sits at the steady level of the take.
    assert evidence['sustained_from_seconds'] > 0.12
    assert evidence['cycle_seconds'] < 5
    with wave.open(str(cycle), 'rb') as audio:
        assert audio.getnchannels() == 2
        assert audio.getframerate() == 48000
    # The cycle opens at the steady level, not in the silence: its first
    # window has to be within the tolerance of the take's reference level.
    opened = _envelope_db(cycle)[0]
    assert opened >= evidence['reference_dbfs'] - AMBIENT_LOOP_LEVEL_TOLERANCE_DB


def test_the_bed_cycle_loops_without_a_hole(tmp_path):
    """The cycle repeated under the whole film must not open a gap."""
    take = _generated_take(tmp_path / 'take.wav')
    cycle = tmp_path / 'cycle.wav'
    build_seamless_loop(take, cycle)
    bed = tmp_path / 'bed.wav'
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-stream_loop', '-1', '-i', str(cycle),
        '-af', 'aresample=48000,apad,atrim=end_sample=2880000',
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(bed),
    ])
    assert check_bed_continuity(bed)['worst_hole_seconds'] == 0