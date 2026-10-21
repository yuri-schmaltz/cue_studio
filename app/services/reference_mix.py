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

from .reference_acceptance import run_media

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
