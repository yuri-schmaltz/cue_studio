"""Tests for the centralised FFmpeg runtime helpers.

These tests don't actually invoke FFmpeg (it may not be installed on
the CI image); they exercise the command builder, the atomic-write
helpers and the error path so the helpers can be imported safely on
every platform the test suite runs on.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from shared.utils import ffmpeg_runtime  # noqa: E402


@contextmanager
def _tmpdir():
    with tempfile.TemporaryDirectory() as raw:
        yield Path(raw)


class FfmpegCmdBuilderTests(unittest.TestCase):
    def test_minimal_invocation(self) -> None:
        cmd = ffmpeg_runtime.ffmpeg_cmd(
            inputs=["/tmp/in.wav"],
            outputs=["/tmp/out.mp3"],
        )
        # Mandatory flags we always set.
        self.assertEqual(cmd[0], "ffmpeg")
        self.assertIn("-hide_banner", cmd)
        self.assertIn("-y", cmd)
        self.assertIn("-loglevel", cmd)
        self.assertIn("-i", cmd)
        self.assertIn("/tmp/in.wav", cmd)
        self.assertIn("/tmp/out.mp3", cmd)

    def test_default_threads_is_zero(self) -> None:
        # The whole point of this helper: every invocation must scale
        # across all CPU cores. The default thread count has to be 0.
        opts = ffmpeg_runtime.FFmpegOptions()
        self.assertEqual(opts.threads, 0)

    def test_extra_global_flags_inserted_before_inputs(self) -> None:
        cmd = ffmpeg_runtime.ffmpeg_cmd(
            inputs=["a"],
            outputs=["b"],
            options=ffmpeg_runtime.FFmpegOptions(extra_global=["-stats"]),
        )
        stats_idx = cmd.index("-stats")
        input_idx = cmd.index("-i")
        self.assertLess(stats_idx, input_idx, "-stats must come before the first -i flag")

    def test_output_options_appear_between_inputs_and_outputs(self) -> None:
        cmd = ffmpeg_runtime.ffmpeg_cmd(
            inputs=["a"],
            outputs=["b"],
            output_options=["-c:a", "aac", "-b:a", "192k"],
        )
        i_idx = cmd.index("-i")
        c_idx = cmd.index("-c:a")
        out_idx = cmd.index("b")
        self.assertLess(i_idx, c_idx)
        self.assertLess(c_idx, out_idx)


class AtomicWriteTests(unittest.TestCase):
    def test_atomic_write_bytes_roundtrip(self) -> None:
        with _tmpdir() as tmp:
            target = tmp / "data.bin"
            ffmpeg_runtime.atomic_write_bytes(target, b"hello world")
            self.assertEqual(target.read_bytes(), b"hello world")
            # No leftover temp files in the directory.
            leftover = [p for p in tmp.iterdir() if p.name.startswith("data.bin.")]
            self.assertEqual(leftover, [])

    def test_atomic_write_json_roundtrip(self) -> None:
        with _tmpdir() as tmp:
            target = tmp / "config.json"
            payload = {"alpha": [1, 2, 3], "beta": "γ"}
            ffmpeg_runtime.atomic_write_json(target, payload)
            loaded = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(loaded, payload)

    def test_atomic_write_overwrites_existing_file(self) -> None:
        with _tmpdir() as tmp:
            target = tmp / "data.bin"
            target.write_bytes(b"old")
            ffmpeg_runtime.atomic_write_bytes(target, b"new")
            self.assertEqual(target.read_bytes(), b"new")

    def test_atomic_write_json_creates_parent_directories(self) -> None:
        with _tmpdir() as tmp:
            target = tmp / "nested" / "dirs" / "config.json"
            ffmpeg_runtime.atomic_write_json(target, {"ok": True})
            self.assertTrue(target.exists())


class FFmpegErrorTests(unittest.TestCase):
    def test_error_message_includes_command_and_stderr(self) -> None:
        err = ffmpeg_runtime.FFmpegError(["ffmpeg", "-i", "missing"], "no such file", 1)
        msg = str(err)
        self.assertIn("exit=1", msg)
        self.assertIn("missing", msg)
        self.assertIn("no such file", msg)


class FakeRunFfprobeTests(unittest.TestCase):
    """``probe_duration_seconds`` is best-effort; only assert the
    function returns ``None`` when no binary is available rather than
    crashing the caller.
    """

    def test_returns_none_when_ffprobe_missing(self) -> None:
        # Temporarily blank PATH so ffprobe cannot be resolved.
        saved = os.environ.get("PATH", "")
        os.environ["PATH"] = ""
        try:
            self.assertIsNone(ffmpeg_runtime.probe_duration_seconds("/tmp/whatever"))
        finally:
            os.environ["PATH"] = saved


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
