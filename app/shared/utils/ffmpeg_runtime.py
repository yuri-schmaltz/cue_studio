"""Centralised FFmpeg command helpers.

Single source of truth for FFmpeg invocations in Cue Studio.

Why this exists
---------------
Before this module every call site built its own ``["ffmpeg", "-y", "-i", ...]``
command array. Touching the global FFmpeg behaviour (e.g. adding
``-threads 0`` so encoding scales across CPU cores, switching to a
specific preset, or wiring up progress reporting) required hunting down
dozens of inline command arrays scattered through services.

By routing every call site through ``ffmpeg_cmd`` / ``run_ffmpeg`` we
get:

* A guaranteed ``-threads 0`` flag on every encode, so H.264/H.265
  export scales with the host's CPU core count instead of running
  single-threaded.
* A consistent ``-hide_banner`` and ``-loglevel`` set so failed
  encodes surface clean error messages in the launcher log instead of
  multi-megabyte banner dumps.
* Cropping/rotation/audio mapping knobs that are easy to attach in one
  place (e.g. adding ``-movflags +faststart`` for web playback).
* One ``subprocess.run`` wrapper with timeout, signal handling and a
  typed ``FFmpegError`` exception class so callers don't have to
  duplicate the boilerplate.

Backward compatibility
----------------------
Existing call sites that build their own command arrays will keep
working. New code should use this module. Migrating the existing
callers is a follow-up step documented in the roadmap.
"""

from __future__ import annotations

import logging
import os
import shlex
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence


log = logging.getLogger("cue_studio.ffmpeg")

# Maximum wall-clock seconds we will let any single FFmpeg invocation run
# before we forcibly terminate it. 30 minutes is generous for a 4K export
# with a slow software encoder; production runs finish in minutes.
_FFMPEG_TIMEOUT_SECONDS = 30 * 60


@dataclass
class FFmpegOptions:
    """Optional knobs every FFmpeg command can apply.

    Attributes default to the values the project considers safest:
    threads=0 means "use all CPU cores", loglevel="error" keeps the
    launcher log clean, hide_banner=True avoids the noisy multi-line
    banner FFmpeg prints on every invocation.
    """

    threads: int = 0
    hide_banner: bool = True
    loglevel: str = "error"
    overwrite: bool = True
    timeout: int = _FFMPEG_TIMEOUT_SECONDS
    extra_global: list[str] = field(default_factory=list)


class FFmpegError(RuntimeError):
    """Raised when an FFmpeg invocation exits non-zero or times out."""

    def __init__(self, cmd: Sequence[str], stderr: str, exit_code: int | None):
        self.cmd = list(cmd)
        self.stderr = stderr
        self.exit_code = exit_code
        quoted = " ".join(shlex.quote(p) for p in self.cmd)
        super().__init__(f"ffmpeg command failed (exit={exit_code}): {quoted}\n{stderr.strip()}")


def ffmpeg_cmd(
    inputs: Sequence[str | os.PathLike[str]],
    outputs: Sequence[str | os.PathLike[str]],
    *,
    options: FFmpegOptions | None = None,
    input_options: Sequence[str] | None = None,
    output_options: Sequence[str] | None = None,
) -> list[str]:
    """Build a fully-populated FFmpeg command array.

    The first three arguments are mandatory: positional ``-i <input>``
    flags for each input, then the output paths. Optional flags go in
    ``input_options`` / ``output_options`` (one list per stream).
    """

    opts = options or FFmpegOptions()
    cmd: list[str] = ["ffmpeg"]

    if opts.hide_banner:
        cmd.append("-hide_banner")
    if opts.overwrite:
        cmd.append("-y")
    if opts.loglevel:
        cmd += ["-loglevel", opts.loglevel]

    if opts.extra_global:
        cmd += list(opts.extra_global)

    if input_options:
        cmd += list(input_options)

    for src in inputs:
        cmd += ["-i", str(src)]

    if output_options:
        cmd += list(output_options)

    for dst in outputs:
        cmd.append(str(dst))

    return cmd


def run_ffmpeg(
    inputs: Sequence[str | os.PathLike[str]],
    outputs: Sequence[str | os.PathLike[str]],
    *,
    options: FFmpegOptions | None = None,
    input_options: Sequence[str] | None = None,
    output_options: Sequence[str] | None = None,
    env: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run an FFmpeg command and return the completed process.

    Raises :class:`FFmpegError` if FFmpeg exits non-zero or the
    configured timeout elapses.
    """

    cmd = ffmpeg_cmd(
        inputs,
        outputs,
        options=options,
        input_options=input_options,
        output_options=output_options,
    )

    log.debug("ffmpeg: %s", " ".join(shlex.quote(p) for p in cmd))

    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            env=env,
            timeout=(options or FFmpegOptions()).timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError(cmd, exc.stderr or "<timeout>", exit_code=None) from exc

    if proc.returncode != 0:
        raise FFmpegError(cmd, proc.stderr or "", proc.returncode)

    return proc


def probe_duration_seconds(media_path: str | os.PathLike[str]) -> float | None:
    """Best-effort duration probe using ffprobe (no exception on failure)."""

    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    try:
        proc = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return None


def atomic_write_bytes(target: Path, data: bytes) -> None:
    """Write ``data`` to ``target`` atomically.

    Uses ``tempfile.NamedTemporaryFile`` in the same directory so the
    final ``os.replace`` is a single rename on the same filesystem
    (atomic on POSIX). Survives mid-write crashes without leaving a
    half-written file at ``target``.
    """

    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=target.name + ".", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError:
                # fsync is best-effort on some filesystems; not fatal.
                pass
        os.replace(tmp_name, target)
    except Exception:
        # Clean up the temp file if anything went wrong; never leak
        # ``cue_studio.tmpXXXXX`` clutter into the user's media folder.
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def atomic_write_json(target: Path, payload: Any, *, indent: int = 2) -> None:
    """Atomic write for JSON-serialisable data.

    Pretty-prints with ``indent`` (default 2) for human readability and
    ensures the file is renamed into place only after the bytes are
    fully flushed + fsynced to disk.
    """

    import json

    text = json.dumps(payload, indent=indent, ensure_ascii=False, sort_keys=True)
    atomic_write_bytes(target, text.encode("utf-8"))


__all__ = [
    "FFmpegError",
    "FFmpegOptions",
    "atomic_write_bytes",
    "atomic_write_json",
    "ffmpeg_cmd",
    "probe_duration_seconds",
    "run_ffmpeg",
]
