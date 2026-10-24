"""Torchaudio compatibility shim for PyTorch 2.14+ / torchaudio 2.11+.

In torchaudio >= 2.9/2.11, several legacy APIs were deprecated or removed:
1. torchaudio.AudioMetaData
2. torchaudio.info
3. torchaudio.list_audio_backends
4. torchaudio.backend.common.AudioMetaData

Downstream libraries such as pyannote.audio (3.3.2) and speechbrain rely on
these symbols. This module monkey-patches torchaudio upon import using soundfile
as a robust fallback backend so that diarization, VAD, and voice cloning work
seamlessly without crashing.
"""

from __future__ import annotations

import dataclasses
import logging
import types

log = logging.getLogger("cue_studio.torchaudio_compat")


def apply_torchaudio_compat() -> None:
    """Apply backwards-compatibility attributes to torchaudio if missing."""
    try:
        import torchaudio
    except ImportError:
        return

    # 1. torchaudio.AudioMetaData
    if not hasattr(torchaudio, "AudioMetaData"):
        @dataclasses.dataclass
        class AudioMetaData:
            sample_rate: int
            num_frames: int
            num_channels: int
            bits_per_sample: int = 16
            encoding: str = "PCM_S"

        torchaudio.AudioMetaData = AudioMetaData

    # 2. torchaudio.info
    if not hasattr(torchaudio, "info"):
        def info(filepath, format=None):
            try:
                import soundfile as sf
                info_sf = sf.info(filepath)
                return torchaudio.AudioMetaData(
                    sample_rate=info_sf.samplerate,
                    num_frames=info_sf.frames,
                    num_channels=info_sf.channels,
                    bits_per_sample=16,
                    encoding=info_sf.subtype or "PCM_S",
                )
            except Exception as e:
                log.warning("[torchaudio_compat] soundfile info failed for %s: %s", filepath, e)
                wav, sr = torchaudio.load(filepath)
                return torchaudio.AudioMetaData(
                    sample_rate=sr,
                    num_frames=wav.shape[-1],
                    num_channels=wav.shape[0],
                    bits_per_sample=16,
                    encoding="PCM_S",
                )

        torchaudio.info = info

    # 3. torchaudio.list_audio_backends
    if not hasattr(torchaudio, "list_audio_backends"):
        torchaudio.list_audio_backends = lambda: ["soundfile"]

    # 4. torchaudio.backend and torchaudio.backend.common
    if not hasattr(torchaudio, "backend"):
        backend_mod = types.ModuleType("torchaudio.backend")
        common_mod = types.ModuleType("torchaudio.backend.common")
        common_mod.AudioMetaData = torchaudio.AudioMetaData
        backend_mod.common = common_mod
        torchaudio.backend = backend_mod
    elif not hasattr(torchaudio.backend, "common"):
        common_mod = types.ModuleType("torchaudio.backend.common")
        common_mod.AudioMetaData = torchaudio.AudioMetaData
        torchaudio.backend.common = common_mod
    elif not hasattr(torchaudio.backend.common, "AudioMetaData"):
        torchaudio.backend.common.AudioMetaData = torchaudio.AudioMetaData


# Apply on module import
apply_torchaudio_compat()
