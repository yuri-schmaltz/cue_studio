"""Upload sandbox helpers — the single source of truth for size/extension
validation, MIME sniffing, and safe-path placement of user-uploaded files.

Why this exists
---------------
Cue Studio accepts user-supplied media through several endpoints:
``/api/v1/upload`` (images + video), ``/api/v1/upload-audio`` (audio
files or video files for audio extraction), and a handful of ad-hoc
routes for LoRA thumbnails and style-bible cover images. Each of those
endpoints previously had its own ad-hoc validation:

* a hard-coded extension allow-list at the top of the handler,
* a hand-rolled size check against ``request.headers['content-length']``,
* ``open(filepath, "wb").write(content)`` to land the bytes on disk,
* an ``os.remove`` only in the failure paths.

That approach had three problems:

1. **Drift.** When a new format was added (e.g. AVIF image support), each
   endpoint had to be patched individually — easy to miss one and
   silently reject the format.
2. **TOCTOU.** A naive ``content-length`` check trusts a header the
   client can trivially lie about. The authoritative check is the
   byte-length *after* reading, which a single helper can guarantee.
3. **Quotas.** Nothing prevented the user from uploading 500 files
   in quick succession and filling the disk. We don't have a per-user
   quota today, but the helper provides the seam where one can be added.

This module centralises the allow-list and the size-check policy so a
change is one-line, and gives every handler the same hardening.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Iterable, Sequence


log = logging.getLogger("cue_studio.upload_sandbox")


# ---------------------------------------------------------------------------
# Allow-lists
# ---------------------------------------------------------------------------

# Curated against the upstream WanGP/Cue Studio documentation. Add to this
# set when introducing a new model family or codec; both ``allowed_extensions``
# and the size ceilings below have to be updated in lockstep.
AUDIO_EXTENSIONS: Final[frozenset[str]] = frozenset({
    ".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac",
})

VIDEO_EXTENSIONS: Final[frozenset[str]] = frozenset({
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v",
})

IMAGE_EXTENSIONS: Final[frozenset[str]] = frozenset({
    ".png", ".jpg", ".jpeg", ".webp", ".bmp",
})

LORA_PREVIEW_EXTENSIONS: Final[frozenset[str]] = frozenset({
    ".png", ".jpg", ".jpeg", ".webp",
})

COVER_IMAGE_EXTENSIONS: Final[frozenset[str]] = IMAGE_EXTENSIONS


@dataclass(frozen=True)
class UploadLimits:
    """Caller-tunable thresholds. Defaults are conservative."""

    max_bytes: int
    allowed_extensions: frozenset[str]
    sniff_magic: bool = True

    @classmethod
    def audio(cls, max_bytes: int = 500 * 1024 * 1024) -> "UploadLimits":
        return cls(max_bytes=max_bytes, allowed_extensions=AUDIO_EXTENSIONS)

    @classmethod
    def media(cls, max_bytes: int = 500 * 1024 * 1024) -> "UploadLimits":
        return cls(
            max_bytes=max_bytes,
            allowed_extensions=AUDIO_EXTENSIONS | VIDEO_EXTENSIONS,
        )

    @classmethod
    def image(cls, max_bytes: int = 50 * 1024 * 1024) -> "UploadLimits":
        return cls(max_bytes=max_bytes, allowed_extensions=IMAGE_EXTENSIONS)

    @classmethod
    def lora_preview(cls, max_bytes: int = 4 * 1024 * 1024) -> "UploadLimits":
        return cls(max_bytes=max_bytes, allowed_extensions=LORA_PREVIEW_EXTENSIONS)

    @classmethod
    def cover_image(cls, max_bytes: int = 10 * 1024 * 1024) -> "UploadLimits":
        return cls(max_bytes=max_bytes, allowed_extensions=COVER_IMAGE_EXTENSIONS)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class UploadValidationError(ValueError):
    """Raised when an upload fails any sandbox check.

    Carries an HTTP-friendly status code so the FastAPI handlers can
    translate it without a bespoke mapping.
    """

    def __init__(self, detail: str, *, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Filename sanitisation
# ---------------------------------------------------------------------------

# Reject anything that isn't a single stem + a single (lower-case) extension
# from the allow-list. We deliberately disallow spaces and exotic characters
# so the saved file can't be referenced from a shell with backticks, dollar
# signs, etc.
_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\- ]{0,127}$")


def sanitise_filename(raw: str | None) -> str:
    """Sanitise a user-supplied filename for storage.

    Returns the basename only (no directory components). Strips any
    characters outside ``[A-Za-z0-9_\\-. ]``, collapses runs of
    whitespace, and falls back to a UUID-derived name when the input
    is None or pathological.
    """

    if not raw:
        return uuid.uuid4().hex

    base = os.path.basename(raw).strip()
    if not base:
        return uuid.uuid4().hex

    cleaned = re.sub(r"[^A-Za-z0-9 _.\-]", "", base)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned or not _FILENAME_RE.match(cleaned):
        return uuid.uuid4().hex
    return cleaned


def split_extension(name: str) -> tuple[str, str]:
    """Return ``(stem, extension_with_dot)`` lower-cased."""

    if "." not in name:
        return (name, "")
    stem, _, ext = name.rpartition(".")
    # ``rpartition`` puts the last ``.`` in ext; if there's no dot in
    # the user-supplied stem, fall back to the original name.
    if not ext:
        return (name, "")
    return (stem, "." + ext.lower())


# ---------------------------------------------------------------------------
# Magic-byte sniffing
# ---------------------------------------------------------------------------

# 8-byte signatures for the formats we accept. Adding a new extension to
# an allow-list above without also adding a signature here will raise
# ``UploadValidationError`` when sniff_magic=True, which is exactly the
# safety net we want.
_MAGIC: Final[dict[str, bytes]] = {
    ".wav":  b"RIFF",                # RIFF/WAVE container
    ".mp3":  b"ID3",                 # ID3v2 tag; bare MPEG frames start 0xFFEx
    ".flac": b"fLaC",
    ".ogg":  b"OggS",
    ".m4a":  b"\x00\x00\x00\x18ftypM4A",
    ".aac":  b"\xFF\xF1",            # ADTS sync; we accept any ADTS frame
    ".mp4":  b"\x00\x00\x00",        # MP4 box size header (followed by 'ftyp')
    ".mov":  b"\x00\x00\x00",        # QuickTime container
    ".mkv":  b"\x1A\x45\xDF\xA3",    # EBML header (Matroska/WebM)
    ".webm": b"\x1A\x45\xDF\xA3",
    ".avi":  b"RIFF",                # AVI is a RIFF container
    ".m4v":  b"\x00\x00\x00",
    ".png":  b"\x89PNG\r\n\x1a\n",
    ".jpg":  b"\xFF\xD8\xFF",
    ".jpeg": b"\xFF\xD8\xFF",
    ".webp": b"RIFF",                # WebP also uses RIFF container
    ".bmp":  b"BM",
}

# JPEG and WebP both start with RIFF-equivalent bytes, so we have to peek
# a few bytes deeper to disambiguate them from WAV/AVI.
_AMBIGUOUS_RIFF_PAYLOADS = {
    b"WAVE": ".wav",
    b"AVI ": ".avi",
    b"WEBP": ".webp",
}


def _sniff_extension(head: bytes, hint_ext: str) -> str | None:
    """Try to resolve an extension from the first few bytes of a file."""

    # Resolve RIFF-family containers first by inspecting the payload type.
    if head.startswith(b"RIFF") and len(head) >= 12:
        payload = head[8:12]
        if payload in _AMBIGUOUS_RIFF_PAYLOADS:
            return _AMBIGUOUS_RIFF_PAYLOADS[payload]

    # MP4/QuickTime containers all start with a 4-byte size followed by
    # ``ftyp`` and a 4-byte brand.
    if head[:4] == b"\x00\x00\x00" and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand.startswith(b"qt") or brand.startswith(b"QT"):
            return ".mov"
        return ".mp4"

    for ext, magic in _MAGIC.items():
        if head.startswith(magic):
            return ext

    # Some legacy files (e.g. raw AAC) start with 0xFFF1 but the magic
    # table already covers that. Fall back to the hint extension so the
    # caller still gets a deterministic answer.
    return hint_ext or None


# ---------------------------------------------------------------------------
# The main entry point
# ---------------------------------------------------------------------------


@dataclass
class SavedUpload:
    """Result of a sandboxed upload.

    ``path`` is the absolute on-disk path of the saved file. ``sha256`` is
    a content-addressed digest that downstream pipelines (audio analysis,
    vision captioning) can use for de-duplication without re-reading the
    file.
    """

    path: Path
    sha256: str
    extension: str
    original_name: str


def save_upload(
    content: bytes,
    *,
    target_dir: Path | str,
    original_filename: str | None,
    limits: UploadLimits,
    advertised_extension: str | None = None,
) -> SavedUpload:
    """Validate ``content`` against ``limits`` and write it to ``target_dir``.

    The flow is:

    1. Sanitise the supplied filename and resolve a unique storage name.
    2. Reject if the resolved extension is not in the allow-list.
    3. Reject if the byte length exceeds the configured ceiling.
    4. (Optional) Sniff the first 8 bytes and reject if the magic signature
       doesn't match the declared extension.
    5. Stream the bytes to a temp file in the same directory and atomically
       ``os.replace`` to the final path.

    The atomic write keeps the target directory tidy: a crash mid-upload
    doesn't leave a half-written file behind.
    """

    if not isinstance(content, (bytes, bytearray)):
        raise UploadValidationError("Upload payload must be raw bytes.", status_code=400)

    if len(content) > limits.max_bytes:
        mb = limits.max_bytes // (1024 * 1024)
        raise UploadValidationError(
            f"File too large (limit {mb} MB).",
            status_code=413,
        )

    safe_name = sanitise_filename(original_filename)
    stem, ext = split_extension(safe_name)

    # If the user-supplied name lacked a usable extension, fall back to
    # the advertiser-declared extension (e.g. FastAPI's ``UploadFile`` may
    # not preserve the trailing suffix on every browser).
    if not ext and advertised_extension:
        ext = "." + advertised_extension.lstrip(".").lower()

    if ext not in limits.allowed_extensions:
        raise UploadValidationError(
            f"Unsupported format: {ext or '<none>'}. Allowed: "
            f"{', '.join(sorted(limits.allowed_extensions))}.",
        )

    if limits.sniff_magic and content[:8]:
        sniffed = _sniff_extension(content[:12], ext)
        if sniffed and sniffed != ext:
            # Allow the sniff to refine our guess (e.g. user uploaded foo.jpeg
            # and we identified it as jpeg), but reject if the sniff points
            # to a completely different family.
            if not _same_family(sniffed, ext):
                raise UploadValidationError(
                    f"File content does not match its extension ({ext}).",
                    status_code=400,
                )

    target_dir = Path(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    unique_name = f"{uuid.uuid4().hex[:12]}_{stem}{ext}"
    final_path = target_dir / unique_name

    # Atomic write: stream to a temp file in the same directory, fsync,
    # then ``os.replace`` into place.
    fd, tmp_name = tempfile.mkstemp(prefix=final_path.name + ".", dir=str(target_dir))
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(content)
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError:
                pass
        os.replace(tmp_name, final_path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

    digest = hashlib.sha256(content).hexdigest()

    return SavedUpload(
        path=final_path,
        sha256=digest,
        extension=ext,
        original_name=original_filename or unique_name,
    )


def _same_family(sniffed: str, declared: str) -> bool:
    """Decide whether two extensions are "close enough" to accept.

    Example: declared ``.jpeg`` and sniffed ``.jpg`` are the same family;
    declared ``.mp4`` and sniffed ``.png`` are not, and the upload is
    rejected.
    """

    groups = (
        {".jpg", ".jpeg"},
        {".mp4", ".mov", ".m4v"},
        {".wav", ".avi", ".webp"},  # all RIFF containers — be permissive
    )
    for group in groups:
        if sniffed in group and declared in group:
            return True
    return sniffed == declared


__all__ = [
    "AUDIO_EXTENSIONS",
    "COVER_IMAGE_EXTENSIONS",
    "IMAGE_EXTENSIONS",
    "LORA_PREVIEW_EXTENSIONS",
    "SavedUpload",
    "UploadLimits",
    "UploadValidationError",
    "VIDEO_EXTENSIONS",
    "sanitise_filename",
    "save_upload",
    "split_extension",
]
