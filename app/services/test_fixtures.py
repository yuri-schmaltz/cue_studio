"""Central registry of test fixture paths for Cue Studio.

The user keeps reference media outside the repo (Google Drive syncs
into ``/home/yuri/Google/``). Tests and development helpers that need
sample video / audio / image / script files read these constants
instead of hard-coding paths.

Why this lives in ``app/services/`` rather than ``tests/conftest.py``:
the paths are useful from BOTH test code and runtime helpers (e.g. a
"Load sample audio" debug button in the Director sidebar). Tests
*consume* the constants via the ``media_library_paths`` fixture defined
in the repo-root ``conftest.py``; the values themselves live with the
runtime so they can't drift between a debug button and a test.

Override at test time
----------------------
Each constant can be overridden by an environment variable so a CI
runner that doesn't have access to ``/home/yuri/Google/`` can point at a
fixture mirror without editing code:

* ``CUE_STUDIO_MEDIA_LIBRARY_DIR`` (default: ``/home/yuri/Google/midias``)
* ``CUE_STUDIO_SCRIPTS_LIBRARY_DIR`` (default:
  ``/home/yuri/Google/documentos/04-biblioteca/roteiros-referencia``)

The env-var override lets the suite run on a fresh checkout with
fixtures copied elsewhere without committing absolute user paths.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

# Default paths — absolute user library locations on the workstation.
_DEFAULT_MEDIA_LIBRARY = "/home/yuri/Google/midias"
_DEFAULT_SCRIPTS_LIBRARY = (
    "/home/yuri/Google/documentos/04-biblioteca/roteiros-referencia"
)


def _resolve_library_path(env_var: str, default: str) -> Path:
    """Resolve a library path from env or default, treating empty
    strings as 'use default' so a stale ``CUE_STUDIO_*=`` export
    doesn't silently turn ``MEDIA_LIBRARY_DIR`` into ``Path('')`` and
    break every later path concat (``Path('') / 'imagens' == 'imagens'``,
    which doesn't exist as an absolute path)."""
    raw = os.environ.get(env_var, "").strip()
    return Path(raw or default)


# Public constants. Tests and runtime helpers read these directly.
MEDIA_LIBRARY_DIR = _resolve_library_path(
    "CUE_STUDIO_MEDIA_LIBRARY_DIR", _DEFAULT_MEDIA_LIBRARY
)
SCRIPTS_LIBRARY_DIR = _resolve_library_path(
    "CUE_STUDIO_SCRIPTS_LIBRARY_DIR", _DEFAULT_SCRIPTS_LIBRARY
)

# Subdirectories of MEDIA_LIBRARY_DIR. The library is split so each
# media kind lives in its own folder — keeping the Director's
# "Upload or generate" picker honest about what kind of file it
# should accept. Tests can glob any of these for fixtures.
MEDIA_AUDIO_SUBDIR = "audios"
MEDIA_IMAGES_SUBDIR = "imagens"
MEDIA_VIDEO_SUBDIR = "videos"  # not yet populated but reserved
MEDIA_SUBDIRS: tuple[str, ...] = (
    MEDIA_AUDIO_SUBDIR,
    MEDIA_IMAGES_SUBDIR,
    MEDIA_VIDEO_SUBDIR,
)

# Subdirectories of SCRIPTS_LIBRARY_DIR. The user's reference tree
# already groups scripts by "cinema" (films) and "series" (TV shows);
# we surface those as separate buckets so a test can pick a short film
# script vs an episodic pilot without globbing the entire library.
SCRIPTS_CINEMA_SUBDIR = "cinema"
SCRIPTS_SERIES_SUBDIR = "series"
SCRIPTS_SUBDIRS: tuple[str, ...] = (
    SCRIPTS_CINEMA_SUBDIR,
    SCRIPTS_SERIES_SUBDIR,
)

# Accepted extensions for each media kind. The Director's file pickers
# use the same MIME whitelist; surfacing them here keeps tests aligned
# with what the UI will actually upload.
AUDIO_EXTENSIONS: tuple[str, ...] = (".mp3", ".wav", ".m4a", ".flac", ".ogg")
IMAGE_EXTENSIONS: tuple[str, ...] = (".jpg", ".jpeg", ".png", ".webp")
VIDEO_EXTENSIONS: tuple[str, ...] = (".mp4", ".mov", ".mkv", ".webm")
SCRIPT_EXTENSIONS: tuple[str, ...] = (".txt", ".md", ".fountain", ".fdx")


def media_subdir(kind: str) -> Path:
    """Return the absolute path to a media subdirectory.

    Raises ``FileNotFoundError`` if the path doesn't exist so tests
    that depend on real fixtures fail fast with a clear message rather
    than silently globbing an empty directory.
    """
    path = MEDIA_LIBRARY_DIR / kind
    if not path.is_dir():
        raise FileNotFoundError(
            f"Media subdirectory not found: {path}. Set "
            f"CUE_STUDIO_MEDIA_LIBRARY_DIR to override the library root."
        )
    return path


def scripts_subdir(kind: str) -> Path:
    """Return the absolute path to a scripts subdirectory."""
    path = SCRIPTS_LIBRARY_DIR / kind
    if not path.is_dir():
        raise FileNotFoundError(
            f"Scripts subdirectory not found: {path}. Set "
            f"CUE_STUDIO_SCRIPTS_LIBRARY_DIR to override the library root."
        )
    return path


def list_audio_files(
    *, recursive: bool = True, include_video_recordings: bool = True
) -> list[Path]:
    """Return all audio files in the library, sorted by mtime (newest first).

    The user's ``audios/`` directory is a mixed bag — it contains both
    dedicated audio recordings (MP3/WAV) and video files (MP4 from
    WhatsApp recordings, screen captures, etc.). Tests that need
    "any audio-like source" should pass
    ``include_video_recordings=True`` (the default) so they pick up
    everything the Director can ingest. Tests that strictly want
    audio-only should pass ``include_video_recordings=False`` and
    accept that the user's library may be sparse.

    ``recursive=True`` walks subdirectories (e.g. ``audios/musicas/``,
    ``audios/gravacoes/``) so the glob doesn't miss anything nested
    inside the user's category folders.
    """
    audio_dir = media_subdir(MEDIA_AUDIO_SUBDIR)
    iterator = audio_dir.rglob("*") if recursive else audio_dir.iterdir()
    accepted = set(AUDIO_EXTENSIONS)
    if include_video_recordings:
        accepted = accepted | set(VIDEO_EXTENSIONS)
    files = [
        p for p in iterator
        if p.is_file() and p.suffix.lower() in accepted
    ]
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def list_image_files(
    subdir: str | None = None, *, recursive: bool = True
) -> list[Path]:
    """Return all image files in the library (or a specific subdir).

    ``subdir`` accepts values like ``"imagens/figuras"`` to scope the
    glob to a category. Tests that need "any human face" or "any
    vehicle" use this to filter the library without enumerating it.

    ``recursive=True`` walks the user's category tree (``figuras``,
    ``robos``, ``veiculos``, …) so the glob picks up everything
    nested inside the folder.
    """
    root = media_subdir(subdir or MEDIA_IMAGES_SUBDIR)
    iterator = root.rglob("*") if recursive else root.iterdir()
    files = [
        p for p in iterator
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    ]
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def list_video_files(*, recursive: bool = True) -> list[Path]:
    """Return all video files in the library.

    The user's tree keeps video references alongside audio recordings
    (no dedicated ``videos/`` folder yet) so we glob the entire
    ``audios/`` directory. ``recursive=True`` picks up files inside
    category folders (``audios/musicas/``, ``audios/gravacoes/``).
    """
    audio_dir = media_subdir(MEDIA_AUDIO_SUBDIR)
    iterator = audio_dir.rglob("*") if recursive else audio_dir.iterdir()
    files = [
        p for p in iterator
        if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS
    ]
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def list_script_files(kind: str = SCRIPTS_CINEMA_SUBDIR) -> list[Path]:
    """Return script files in the requested subdir (cinema or series)."""
    root = scripts_subdir(kind)
    files = [
        p for p in root.iterdir()
        if p.is_file() and p.suffix.lower() in SCRIPT_EXTENSIONS
    ]
    return sorted(files)


def first_audio(*, max_size_bytes: int | None = None) -> Path:
    """Return the most-recent audio file. Test convenience for "any
    audio" without naming a specific fixture.

    ``max_size_bytes`` skips files larger than the limit — useful for
    HTTP upload tests where the dev server has a body-size cap
    (Uvicorn's default is ~1 MB on dev). Pass ``None`` (default) to
    accept any size.
    """
    files = list_audio_files()
    if max_size_bytes is not None:
        sized = [p for p in files if p.stat().st_size <= max_size_bytes]
        if sized:
            files = sized
    if not files:
        raise FileNotFoundError(f"No audio files in {media_subdir(MEDIA_AUDIO_SUBDIR)}")
    return files[0]


def first_image() -> Path:
    """Return the most-recent image file."""
    files = list_image_files()
    if not files:
        raise FileNotFoundError(f"No image files in {media_subdir(MEDIA_IMAGES_SUBDIR)}")
    return files[0]


def first_script(kind: str = SCRIPTS_CINEMA_SUBDIR) -> Path:
    """Return the first script in the requested subdir (alphabetical)."""
    files = list_script_files(kind)
    if not files:
        raise FileNotFoundError(f"No script files in {scripts_subdir(kind)}")
    return files[0]


def iter_media() -> Iterator[Path]:
    """Yield every media file across all known subdirs.

    Convenience for parametrized tests that want to walk the entire
    library without picking one kind at a time.
    """
    for kind in MEDIA_SUBDIRS:
        try:
            for p in media_subdir(kind).iterdir():
                if p.is_file():
                    yield p
        except FileNotFoundError:
            continue


def library_summary() -> dict[str, object]:
    """Return a small dict with counts per kind — useful for sanity-check
    tests that just want to assert "the library has audio" without
    globbing. Tolerates missing subdirs so a partial library doesn't
    break tests that only need one kind."""
    summary: dict[str, object] = {
        "media_root": str(MEDIA_LIBRARY_DIR),
        "scripts_root": str(SCRIPTS_LIBRARY_DIR),
        "media": {},
        "scripts": {},
    }
    for kind in MEDIA_SUBDIRS:
        try:
            summary["media"][kind] = len(list_audio_files() if kind == MEDIA_AUDIO_SUBDIR
                                          else list_image_files() if kind == MEDIA_IMAGES_SUBDIR
                                          else list_video_files())
        except FileNotFoundError:
            summary["media"][kind] = 0
    for kind in SCRIPTS_SUBDIRS:
        try:
            summary["scripts"][kind] = len(list_script_files(kind))
        except FileNotFoundError:
            summary["scripts"][kind] = 0
    return summary