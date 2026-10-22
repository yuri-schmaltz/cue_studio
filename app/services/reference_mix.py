"""Measured audio mix policy for the F2 reference film.

The reference film's stems come from unrelated models whose native levels
have nothing to do with each other: the ACE-Step music bed measures about
-13.7 LUFS while the Qwen3-TTS narration measures about -25.8 LUFS.
Normalising the *sum* cannot repair that, because a single gain rescales
every stem together and therefore preserves the very ratio that buries the
voice. The narration has to be levelled against an absolute anchor for its
role before the mix, and the sum is then brought to the programme target
with a measured linear pass, which applies one static gain and leaves the
authored ratios alone.

The policy is deliberately explicit rather than emergent: each stem role has
a named anchor, the mix is measured afterwards, and the narration must be
measured above the bed for the mix to be accepted.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
import tempfile
import wave

from .reference_acceptance import run_media, run_media_bytes

# Absolute anchors per stem role. The narration is the foreground; the bed
# sits a decade below it, the room tone below the bed, and transient effects
# are anchored by peak because a short effect's loudness depends on how long
# the generator made it.
SPEECH_LUFS = -18.0
MUSIC_LUFS = -28.0
AMBIENT_LUFS = -34.0
EFFECT_PEAK_DBFS = -6.0

# The programme as a whole: the acceptance criteria measure -16 LUFS with a
# true peak at or below -1 dBTP.
PROGRAMME_LUFS = -16.0
PROGRAMME_TRUE_PEAK = -2.0
LOUDNESS_RANGE = 11

# The ceiling the mix bus limits to, half a decibel below the acceptance
# criterion, so that the encoding downstream has room to overshoot.
PEAK_CEILING_DBFS = -2.5

# The programme loudness is reached with a tolerance; the correction loop
# stops once the measured programme is this close to the target.
LOUDNESS_TOLERANCE_LU = 0.2

# The narration has to be measurably above the bed, otherwise the mix
# masks it again no matter what the integrated loudness says.
MIN_SPEECH_MARGIN_DB = 3.0

# The ambient bed is generated as one short take and repeated under the
# whole film. The take opens with digital silence and swells to its steady
# level, so repeating the raw file repeats that silence at every cycle and
# the mix carries the holes. The bed is therefore built as a single
# continuous cycle: the sustained stretch of the take is kept and its end
# is crossfaded over its beginning.
AMBIENT_LOOP_CROSSFADE_SECONDS = 0.5
AMBIENT_LOOP_LEVEL_TOLERANCE_DB = 6.0
AMBIENT_LOOP_REFERENCE_FRACTION = 0.25

# The level of a file is read in windows this long. A gap shorter than
# this cannot be seen, and the windows have to be short enough to catch
# the 100 ms holes the looping bed produced.
ENVELOPE_WINDOW_SECONDS = 0.05

# The bed must hold its level: a hole in the room tone is heard as a gap
# in the film. The stem is rejected when it drops this far below its own
# median for at least this long. The v9 bed falls 18 dB below its median
# in groups of up to 250 ms; the seamless bed never falls more than
# 4,42 dB below its median.
BED_HOLE_TOLERANCE_DB = 18.0
BED_HOLE_MIN_SECONDS = 0.1

# The music has to still be playing when the picture ends. The generator
# stops writing new music before the requested duration and repeats its
# last code, so a long request ends in silence. The stem is rejected when
# its last seconds fall this far below the body of the track.
MUSIC_TAIL_SECONDS = 3.0
MUSIC_TAIL_DROP_DB = 12.0


@dataclass(frozen=True)
class Stem:
    """One placed stem and the role it plays in the mix."""

    path: Path
    kind: str
    weight: float = 1.0


def measure(path: Path, *, target_lufs: float = PROGRAMME_LUFS,
            target_true_peak: float = PROGRAMME_TRUE_PEAK) -> dict:
    """Measure a file with the same loudness filter the acceptance gate uses."""
    measured = run_media([
        'ffmpeg', '-hide_banner', '-i', str(path), '-vn',
        '-af', f'loudnorm=I={target_lufs}:TP={target_true_peak}:LRA={LOUDNESS_RANGE}:print_format=json',
        '-f', 'null', '-',
    ]).stderr
    payload = json.loads(measured[measured.rfind('{'):])
    for key in ('input_i', 'input_tp'):
        if not math.isfinite(float(payload[key])):
            raise ValueError(f"{Path(path).name}: stem carries no measurable level")
    return payload


def window_loudness(path: Path, start: float, duration: float) -> float:
    """Integrated loudness of one window of a file, in LUFS."""
    measured = run_media([
        'ffmpeg', '-hide_banner', '-ss', f'{start:.3f}', '-t', f'{duration:.3f}',
        '-i', str(path), '-vn',
        '-af', f'loudnorm=I={PROGRAMME_LUFS}:TP={PROGRAMME_TRUE_PEAK}:LRA={LOUDNESS_RANGE}:print_format=json',
        '-f', 'null', '-',
    ]).stderr
    payload = json.loads(measured[measured.rfind('{'):])
    return float(payload['input_i'])


def _anchor(stem: Stem) -> tuple[str, float]:
    if stem.kind == 'speech':
        return 'lufs', SPEECH_LUFS
    if stem.kind == 'music':
        return 'lufs', MUSIC_LUFS
    if stem.kind == 'ambient':
        return 'lufs', AMBIENT_LUFS
    if stem.kind == 'effect':
        return 'peak', EFFECT_PEAK_DBFS + 20 * math.log10(stem.weight)
    raise ValueError(f"Unknown stem role: {stem.kind}")


def level_stem(stem: Stem, destination: Path) -> float:
    """Write the stem at its role anchor; returns the applied gain in dB."""
    basis, anchor = _anchor(stem)
    payload = measure(stem.path)
    measured = float(payload['input_tp'] if basis == 'peak' else payload['input_i'])
    gain = anchor - measured
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-i', str(stem.path),
        '-af', f'volume={gain:.4f}dB', '-ar', '48000', '-ac', '2',
        '-c:a', 'pcm_f32le', str(destination),
    ])
    return gain


def level_stems(stems: list[Stem], directory: Path) -> list[Path]:
    """Level every stem into `directory` and return the levelled paths."""
    directory.mkdir(parents=True, exist_ok=True)
    leveled = []
    for index, stem in enumerate(stems):
        destination = directory / f'{index:02d}-{stem.path.stem}.wav'
        level_stem(stem, destination)
        leveled.append(destination)
    return leveled


def _render_mix(source: Path, destination: Path, gain: float, samples: int | None) -> None:
    """Write the summed programme with one static gain and a peak limiter.

    The gain is a single number applied to the whole programme, so the
    balance the per-role levels established survives untouched. The limiter
    only acts on the peaks that would otherwise exceed the ceiling, and it
    releases quickly enough that the narration is not ducked.
    """
    chain = [
        f'volume={gain:.4f}dB',
        f'alimiter=limit={10 ** (PEAK_CEILING_DBFS / 20):.6f}:attack=5:release=50:level=disabled',
        'aresample=48000',
    ]
    if samples:
        chain += ['apad', f'atrim=end_sample={samples}']
    run_media([
        'ffmpeg', '-y', '-v', 'error', '-i', str(source), '-af', ','.join(chain),
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(destination),
    ])


def mix_stems(stems: list[Path], destination: Path, *, samples: int | None = None) -> dict:
    """Sum levelled stems and bring the programme to its loudness target.

    The stems are summed without `amix` normalisation: normalising would
    divide every input by the input count, which is a uniform gain and so
    cannot change the balance the levels established. The sum is written as
    float so the intermediate signal is never clipped.

    The programme target is reached with a *static* gain, measured from the
    sum itself. `loudnorm` is deliberately not used for this: its linear
    mode is refused whenever the gain would push the true peak past the
    target, and it then falls back to a dynamic mode that re-equalises
    quiet passages and buries the narration under the bed. A limiter on the
    mix bus keeps the peaks under the ceiling without touching the balance.
    """
    if not stems:
        raise ValueError('A mix needs at least one stem')
    with tempfile.TemporaryDirectory(dir=str(destination.parent)) as workspace:
        summed = Path(workspace) / 'sum.wav'
        inputs = [argument for path in stems for argument in ('-i', str(path))]
        run_media([
            'ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex',
            f'amix=inputs={len(stems)}:duration=longest:normalize=0',
            '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', str(summed),
        ])
        # The limiter shaves the peaks, which lowers the programme a
        # little, so the gain is corrected until the measured programme
        # sits on the target. Every correction is measured from the
        # rendered mix, never assumed.
        gain = PROGRAMME_LUFS - float(measure(summed)['input_i'])
        rendered = Path(workspace) / 'rendered.wav'
        for _ in range(4):
            _render_mix(summed, rendered, gain, samples)
            error = PROGRAMME_LUFS - float(measure(rendered)['input_i'])
            if abs(error) <= LOUDNESS_TOLERANCE_LU:
                break
            gain += error
        rendered.replace(destination)
    payload = measure(destination)
    return {
        'loudness_lufs': float(payload['input_i']),
        'true_peak_dbtp': float(payload['input_tp']),
        'stems': len(stems),
    }


def narration_margin_db(mix: Path, speech: tuple[float, float], bed: tuple[float, float]) -> float:
    """How far the narration rises above the bed, measured on the mixed film.

    Both windows are read from the finished mix, so the comparison describes
    what a listener actually hears and is not affected by how loud the
    programme as a whole happens to be.
    """
    return window_loudness(mix, *speech) - window_loudness(mix, *bed)


def _numpy():
    import numpy as np
    return np


def _pcm(path: Path, sample_rate: int = 48000) -> 'np.ndarray':
    """Decode a media file into stereo float samples.

    The samples themselves are needed, not a summary of them: a gap in the
    bed and a frozen tail in the music are only visible in the waveform.
    """
    np = _numpy()
    raw = run_media_bytes([
        'ffmpeg', '-v', 'error', '-i', str(path), '-vn',
        '-f', 's16le', '-ac', '2', '-ar', str(sample_rate), '-',
    ])
    return np.frombuffer(raw, '<i2').astype(np.float32).reshape(-1, 2) / 32768.0


def _envelope_db(path: Path, window_seconds: float = ENVELOPE_WINDOW_SECONDS) -> 'np.ndarray':
    """The level of a file in short windows, in dBFS."""
    np = _numpy()
    samples = _pcm(path)
    window = int(window_seconds * 48000)
    count = len(samples) // window
    if not count:
        raise ValueError(f"{Path(path).name}: file is shorter than one measurement window")
    blocks = samples[:count * window].reshape(count, window, 2)
    power = (blocks.astype(np.float64) ** 2).sum(axis=2).mean(axis=1)
    return 10 * np.log10(np.maximum(power, 1e-20))


def _runs_below(envelope: 'np.ndarray', threshold: float) -> list[tuple[float, float]]:
    """Every stretch of the envelope under a threshold, as (start, length)."""
    below = envelope < threshold
    runs: list[tuple[float, float]] = []
    index = 0
    while index < len(below):
        if below[index]:
            end = index
            while end < len(below) and below[end]:
                end += 1
            runs.append((index * ENVELOPE_WINDOW_SECONDS, (end - index) * ENVELOPE_WINDOW_SECONDS))
            index = end
        else:
            index += 1
    return runs


def build_seamless_loop(source: Path, destination: Path, *,
                        crossfade_seconds: float = AMBIENT_LOOP_CROSSFADE_SECONDS) -> dict:
    """Write a cycle of the take that loops without a gap.

    The generator returns one short take of room tone that opens with
    digital silence and swells up to its steady level. Repeating that file
    as it is repeats the silence at every cycle, and the mix then carries
    the holes. This builds the cycle instead: the sustained part of the
    take is kept, and its end is crossfaded over its beginning with equal
    power, so the cycle joins itself without a discontinuity and without
    the level change the raw take would bring.

    The sustained part is found by measurement, not by a fixed offset: the
    level of the last quarter of the take is the reference, and the window
    kept is the stretch that never falls below that level by more than
    AMBIENT_LOOP_LEVEL_TOLERANCE_DB.
    """
    np = _numpy()
    samples = _pcm(source)
    envelope = _envelope_db(source)
    reference = float(np.median(envelope[int(len(envelope) * (1 - AMBIENT_LOOP_REFERENCE_FRACTION)):]))
    threshold = reference - AMBIENT_LOOP_LEVEL_TOLERANCE_DB
    below = envelope < threshold
    half = len(below) // 2
    start = 0
    for index in range(half):
        if below[index]:
            start = index + 1
    end = len(below)
    for index in range(len(below) - 1, half, -1):
        if below[index]:
            end = index
    window = int(ENVELOPE_WINDOW_SECONDS * 48000)
    body = samples[start * window:end * window]
    overlap = int(round(crossfade_seconds * 48000))
    if len(body) <= 2 * overlap:
        raise ValueError(f"{Path(source).name}: the take is too short to loop")
    head = body[:overlap]
    tail = body[-overlap:]
    # Equal power: the two halves of the fade keep the sum of the powers
    # constant, so the seam does not dip below the level around it.
    ramp = np.linspace(0.0, 1.0, overlap, endpoint=False)[:, None]
    blend = tail * np.cos(np.pi / 2 * ramp) + head * np.sin(np.pi / 2 * ramp)
    cycle = np.concatenate([blend, body[overlap:len(body) - overlap]])
    data = np.clip(cycle, -1.0, 1.0)
    with wave.open(str(destination), 'wb') as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(48000)
        audio.writeframes((data * 32767).astype('<i2').tobytes())
    return {
        'source': Path(source).name,
        'cycle_seconds': len(cycle) / 48000,
        'sustained_from_seconds': start * ENVELOPE_WINDOW_SECONDS,
        'sustained_to_seconds': end * ENVELOPE_WINDOW_SECONDS,
        'reference_dbfs': reference,
        'crossfade_seconds': crossfade_seconds,
    }


def check_bed_continuity(path: Path) -> dict:
    """The bed has to hold its level for the whole film.

    A hole in the room tone is heard as a gap under the picture, and no
    amount of loudness elsewhere hides it. The stem is measured against its
    own median, so the gate does not depend on how loud the bed was
    levelled to.
    """
    envelope = _envelope_db(path)
    median = float(_numpy().median(envelope))
    threshold = median - BED_HOLE_TOLERANCE_DB
    holes = _runs_below(envelope, threshold)
    worst = max((length for _, length in holes), default=0.0)
    if worst >= BED_HOLE_MIN_SECONDS:
        raise ValueError(
            f"{Path(path).name}: the bed falls {BED_HOLE_TOLERANCE_DB:.0f} dB below its median "
            f"for {worst * 1000:.0f} ms; the ambient loop repeats a gap")
    return {
        'median_dbfs': median,
        'threshold_dbfs': threshold,
        'worst_hole_seconds': worst,
        'holes': len(holes),
    }


def check_music_coverage(path: Path) -> dict:
    """The music has to still be playing when the picture ends.

    The music generator stops writing new music before the duration it was
    asked for and repeats its last code from there on, so a long request
    ends in a frozen tail. The stem is rejected when its last seconds sit
    far below the body of the track.
    """
    np = _numpy()
    envelope = _envelope_db(path)
    tail_blocks = int(MUSIC_TAIL_SECONDS / ENVELOPE_WINDOW_SECONDS)
    if len(envelope) <= tail_blocks:
        raise ValueError(f"{Path(path).name}: the music is shorter than its own tail window")
    body = envelope[:-tail_blocks]
    tail = envelope[-tail_blocks:]
    body_median = float(np.median(body))
    tail_median = float(np.median(tail))
    drop = body_median - tail_median
    if drop > MUSIC_TAIL_DROP_DB:
        raise ValueError(
            f"{Path(path).name}: the music falls {drop:.1f} dB in its last {MUSIC_TAIL_SECONDS:.0f} s; "
            f"the track dies before the picture ends")
    return {
        'body_median_dbfs': body_median,
        'tail_median_dbfs': tail_median,
        'tail_drop_db': drop,
    }
