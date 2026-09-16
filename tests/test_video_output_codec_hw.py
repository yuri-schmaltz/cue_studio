"""Tests for the hardware-accelerated aliases exposed by save_video().

The aliases ``h264_nvenc``, ``h264_amf``, ``h264_qsv``, ``h264_videotoolbox``
and ``h264_vaapi`` are only available on hosts where FFmpeg advertises the
matching encoder (and, for VAAPI, where a render node is reachable). These
tests cover both the always-present software codecs and the lazy resolver
behaviour — they never depend on the host actually owning a GPU.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def audio_video():
    """Import audio_video lazily — it's a heavy module with optional deps."""
    return importlib.import_module("app.shared.utils.audio_video")


def test_software_codecs_still_returned(audio_video):
    """The legacy software codecs must keep their existing kwargs shape."""
    assert audio_video._get_codec_params("libx264_8", "mp4") == {
        "codec": "libx264", "quality": 8, "pixelformat": "yuv420p",
    }
    assert audio_video._get_codec_params("libx264_10", "mp4") == {
        "codec": "libx264", "quality": 10, "pixelformat": "yuv420p",
    }
    assert audio_video._get_codec_params("libx265_8", "mp4")["codec"] == "libx265"
    assert audio_video._get_codec_params("libx265_28", "mp4")["codec"] == "libx265"
    lossless_mkv = audio_video._get_codec_params("libx264_lossless", "mkv")
    assert lossless_mkv == {"codec": "ffv1", "pixelformat": "rgb24"}
    lossless_mp4 = audio_video._get_codec_params("libx264_lossless", "mp4")
    assert lossless_mp4["codec"] == "libx264"
    assert "-crf" in lossless_mp4["output_params"]


def test_unknown_codec_falls_back_to_libx264(audio_video):
    assert audio_video._get_codec_params("not-a-real-codec", "mp4") == {
        "codec": "libx264", "pixelformat": "yuv420p",
    }


def test_hw_aliases_have_consistent_shape(audio_video, monkeypatch):
    """Every detected HW alias must produce a kwargs dict imageio accepts.

    We monkeypatch the cached probe so the test is hermetic — it asserts
    the *contract* (codec name + pixel format + output_params list) without
    requiring a real GPU.
    """
    monkeypatch.setattr(
        audio_video, "_HW_VIDEO_ENCODERS",
        {
            "h264_nvenc": {
                "codec": "h264_nvenc", "pixelformat": "yuv420p",
                "output_params": ["-preset", "p5", "-rc", "vbr", "-cq", "19"],
            },
            "h264_amf": {
                "codec": "h264_amf", "pixelformat": "yuv420p",
                "output_params": ["-rc", "vbr", "-qp", "20"],
            },
            "h264_qsv": {
                "codec": "h264_qsv", "pixelformat": "yuv420p",
                "output_params": ["-preset", "medium", "-global_quality", "22"],
            },
            "h264_videotoolbox": {
                "codec": "h264_videotoolbox", "pixelformat": "yuv420p",
                "output_params": ["-b:v", "8M", "-realtime", "true"],
            },
            "h264_vaapi": {
                "codec": "h264_vaapi", "pixelformat": "yuv420p",
                "output_params": [
                    "-vaapi_device", "/dev/dri/renderD128",
                    "-rc_mode", "VBR", "-qp", "22",
                ],
            },
        },
    )
    audio_video._hw_video_encoders_table.cache_clear() if hasattr(
        audio_video._hw_video_encoders_table, "cache_clear"
    ) else None
    for alias, expected_codec in (
        ("h264_nvenc", "h264_nvenc"),
        ("h264_amf", "h264_amf"),
        ("h264_qsv", "h264_qsv"),
        ("h264_videotoolbox", "h264_videotoolbox"),
        ("h264_vaapi", "h264_vaapi"),
    ):
        params = audio_video._get_codec_params(alias, "mp4")
        assert params["codec"] == expected_codec
        assert params["pixelformat"] == "yuv420p"
        assert isinstance(params["output_params"], list)
        assert params["output_params"], f"empty output_params for {alias}"


def test_hw_aliases_drop_to_software_when_unavailable(audio_video, monkeypatch):
    """Asking for an HW alias that the probe didn't report must NOT crash.

    The contract is: fall back to libx264 (same behaviour as an unknown
    codec). This keeps the imageio call valid even on hosts where the
    user has a stale saved setting that targets a backend they later
    removed (e.g. macOS user who switched to a Linux box).
    """
    monkeypatch.setattr(audio_video, "_HW_VIDEO_ENCODERS", {})
    params = audio_video._get_codec_params("h264_nvenc", "mp4")
    assert params == {"codec": "libx264", "pixelformat": "yuv420p"}


def test_hw_video_output_codecs_exported(audio_video):
    """The dropdown in the UI should know which aliases to offer."""
    expected = {
        "h264_nvenc", "h264_amf", "h264_qsv",
        "h264_videotoolbox", "h264_vaapi",
    }
    assert expected.issubset(set(audio_video.HW_VIDEO_OUTPUT_CODECS))


def test_hw_probe_falls_back_when_editor_capabilities_missing(
    audio_video, monkeypatch
):
    """A probe failure (editor_projects not importable) must not raise.

    Some worker processes import audio_video without the editor module
    on the path. The lazy table has to swallow that gracefully and just
    return an empty dict so the rest of the module stays usable.
    """
    def _boom():
        raise ImportError("simulated missing editor_projects")
    monkeypatch.setattr(
        audio_video, "_hw_video_encoders", _boom
    )
    audio_video._HW_VIDEO_ENCODERS = None
    assert audio_video._hw_video_encoders_table() == {}


def _install_fake_capabilities(monkeypatch, payload):
    """Inject a fake ``editor_export_capabilities`` into the probe path.

    ``_hw_video_encoders`` imports the symbol lazily inside its body
    *and* wraps it with ``functools.lru_cache``. We patch the module
    attribute the lazy import resolves to, clear both caches, and let
    the next call rebuild the table from the fake.
    """
    import importlib
    import sys
    mod = sys.modules.get("services.editor_projects")
    if mod is None:
        mod = importlib.import_module("services.editor_projects")
    monkeypatch.setattr(mod, "editor_export_capabilities", lambda *a, **k: payload)
    # Clear the @lru_cache on the probe function and the lazy table
    # cache on audio_video. Without this, the first fake-less probe
    # result sticks around for the rest of the test session.
    from app.shared.utils import audio_video
    audio_video._hw_video_encoders.cache_clear()
    monkeypatch.setattr(audio_video, "_HW_VIDEO_ENCODERS", None)


def test_hevc_and_av1_hw_aliases_round_trip(audio_video, monkeypatch):
    """HEVC and AV1 hardware aliases must be built from the same probe.

    We simulate a host with all 5 backends advertising every codec —
    the resulting table must contain the H.264 *and* HEVC *and* AV1
    entry for each backend, each with a sane output_params list.
    """
    _install_fake_capabilities(monkeypatch, {
        "encoders": {
            key: True for key in ("nvidia", "amd", "intel", "apple", "vaapi")
        },
        "encoders_by_codec": {
            key: {"h264": True, "hevc": True, "av1": True}
            for key in ("nvidia", "amd", "intel", "apple", "vaapi")
        },
        "recommended": "nvidia",
    })
    audio_video._HW_VIDEO_ENCODERS = None
    table = audio_video._hw_video_encoders_table()
    expected_codecs = {
        "h264_nvenc", "hevc_nvenc", "av1_nvenc",
        "h264_amf", "hevc_amf", "av1_amf",
        "h264_qsv", "hevc_qsv", "av1_qsv",
        "h264_videotoolbox", "hevc_videotoolbox", "av1_videotoolbox",
        "h264_vaapi", "hevc_vaapi", "av1_vaapi",
    }
    assert expected_codecs.issubset(set(table))
    for alias in expected_codecs:
        entry = table[alias]
        assert entry["codec"] == alias
        assert entry["pixelformat"] == "yuv420p"
        assert isinstance(entry["output_params"], list)
        assert entry["output_params"], f"empty output_params for {alias}"


def test_av1_only_listed_when_per_codec_probe_reports_it(audio_video, monkeypatch):
    """A host with HEVC but no AV1 must not advertise av1_* aliases.

    The structured ``encoders_by_codec`` table distinguishes the two
    families — falling back to the flat ``encoders`` flag would either
    hide HEVC when AV1 is missing (wrong) or expose AV1 aliases that
    fail at runtime (worse).
    """
    _install_fake_capabilities(monkeypatch, {
        "encoders": {
            "nvidia": True, "amd": False, "intel": False,
            "apple": False, "vaapi": False,
        },
        "encoders_by_codec": {
            "nvidia": {"h264": True, "hevc": True, "av1": False},
            "amd": {"h264": False, "hevc": False, "av1": False},
            "intel": {"h264": False, "hevc": False, "av1": False},
            "apple": {"h264": False, "hevc": False, "av1": False},
            "vaapi": {"h264": False, "hevc": False, "av1": False},
        },
        "recommended": "nvidia",
    })
    audio_video._HW_VIDEO_ENCODERS = None
    table = audio_video._hw_video_encoders_table()
    assert "h264_nvenc" in table
    assert "hevc_nvenc" in table
    assert "av1_nvenc" not in table


def test_legacy_capabilities_shape_still_drives_hevc_and_av1(audio_video, monkeypatch):
    """Older callers return only the flat ``encoders`` dict.

    Without ``encoders_by_codec`` the probe must still mark every codec
    family as available — otherwise a host that hasn't refreshed the
    editor probe would lose HEVC/AV1 after a single server restart.
    """
    _install_fake_capabilities(monkeypatch, {
        "encoders": {"nvidia": True},
        "recommended": "nvidia",
    })
    audio_video._HW_VIDEO_ENCODERS = None
    table = audio_video._hw_video_encoders_table()
    for alias in ("h264_nvenc", "hevc_nvenc", "av1_nvenc"):
        assert alias in table, f"expected {alias} when only flat flag is set"


def test_save_video_falls_back_to_libx264_when_hw_encoder_fails(
    audio_video, monkeypatch, tmp_path
):
    """When the hardware encoder fails, save_video retries with libx264_8.

    We simulate the failure by patching imageio.get_writer so the first
    call (for the HW alias) raises, and the second call (libx264_8)
    succeeds silently. The fallback must be transparent to callers — the
    returned path matches the requested save_file.
    """
    hw_entry = {
        "codec": "h264_nvenc", "pixelformat": "yuv420p",
        "output_params": ["-preset", "p5"],
    }
    sw_entry = {
        "codec": "libx264", "quality": 8, "pixelformat": "yuv420p",
    }

    def _fake_get_codec_params(codec, container):
        if codec == "h264_nvenc":
            return dict(hw_entry)
        if codec == "libx264_8":
            return dict(sw_entry)
        # Anything else (shouldn't happen in this test) — fall through
        # to the original implementation via the unpatched call.
        return audio_video._get_codec_params.__wrapped__(codec, container)

    # ``__wrapped__`` is set when a function is decorated with functools.wraps.
    # Our local _get_codec_params isn't, so bind to the source directly via
    # a captured reference. Simpler: re-import the module's source-of-truth.
    # We do this by reaching into the module's globals which pytest will
    # restore after the test.
    monkeypatch.setattr(audio_video, "_get_codec_params", _fake_get_codec_params)
    monkeypatch.setattr(audio_video, "_HW_VIDEO_ENCODERS", {"h264_nvenc": hw_entry})

    calls: list[dict] = []

    class _FakeWriter:
        def __init__(self, *args, **kwargs):
            calls.append(dict(kwargs))
            if kwargs.get("codec") == "h264_nvenc":
                raise RuntimeError("NVENC: device busy")

        def append_data(self, *_):
            pass

        def close(self):
            pass

    monkeypatch.setattr(audio_video.imageio, "get_writer", _FakeWriter)

    import torch
    tensor = torch.zeros((1, 3, 4, 4, 3), dtype=torch.uint8)
    out = tmp_path / "fallback.mp4"
    path = audio_video.save_video(
        tensor, save_file=str(out), fps=24, codec_type="h264_nvenc", retry=2
    )
    assert path == str(out)
    assert calls, "imageio.get_writer was never invoked"
    codecs_seen = [c.get("codec") for c in calls]
    assert "h264_nvenc" in codecs_seen
    assert "libx264" in codecs_seen


def test_save_video_does_not_fallback_for_software_codecs(
    audio_video, monkeypatch
):
    """Software codecs must NOT trigger the HW fallback path.

    The fallback is opt-in via the HW table — a misclassified alias
    would silently retry with libx264 and waste a generation cycle.
    """
    calls: list[dict] = []

    class _FakeWriter:
        def __init__(self, *args, **kwargs):
            calls.append(dict(kwargs))
            raise RuntimeError("simulated libx264 failure")

        def append_data(self, *_):
            pass

        def close(self):
            pass

    monkeypatch.setattr(audio_video.imageio, "get_writer", _FakeWriter)
    # Pre-populate the HW table with an unrelated alias so save_video
    # can't accidentally classify libx264_8 as HW. The test asserts
    # that even with a populated table, software codecs are NOT in it.
    monkeypatch.setattr(audio_video, "_HW_VIDEO_ENCODERS", {"h264_nvenc": {}})
    import torch
    tensor = torch.zeros((1, 3, 4, 4, 3), dtype=torch.uint8)
    with pytest.raises(RuntimeError):
        audio_video.save_video(
            tensor, save_file="/tmp/should-not-exist.mp4",
            fps=24, codec_type="libx264_8", retry=2,
        )
    codecs_seen = [c.get("codec") for c in calls]
    assert codecs_seen, "imageio.get_writer was never invoked"
    # Every attempt must have used libx264 (the requested codec).
    assert all(c == "libx264" for c in codecs_seen)
    # No fallback to a different encoder.
    assert "h264_nvenc" not in codecs_seen
