"""Persistence and validation for per-workspace Project Setup defaults.

This module deliberately has no FastAPI or WanGP dependency. The launch
module supplies the configured output root and maps ``WorkspaceSetupError``
to HTTP responses at the API boundary. Keeping the file contract here makes
it possible to test setup persistence without importing the full generation
server in future callers.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any


class WorkspaceSetupError(Exception):
    """Validation or persistence failure with an HTTP-compatible status."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


DEFAULT_PROJECT_SETUP: dict[str, Any] = {
    "aspect_ratio": "16:9",
    "resolution": "720p",
    "seamless": False,
    "auto_mode": False,
    "video_model": "",
    "image_model": "",
    "music_source": "upload",
    "music_model": "",
    "default_image_loras": {},
    "default_video_loras": {},
    "advanced": {},
    "description": "",
    "tags": [],
    "pinned": False,
    "director_skill": "music_video",
    "cover_image": "",
    "schema_version": 1,
}

COVER_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
MAX_COVER_IMAGE_BYTES = 10 * 1024 * 1024
_COVER_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")

_WORKSPACE_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
_STRING_FIELDS = {"aspect_ratio", "resolution", "video_model", "image_model", "music_model", "description"}
_BOOL_FIELDS = {"seamless", "auto_mode", "pinned"}
_LIST_STRING_FIELDS = {"tags"}
_OBJECT_FIELDS = {"default_image_loras", "default_video_loras", "advanced"}


def _safe_join(base: str, name: str) -> str | None:
    """Join one workspace segment without allowing traversal."""
    base_real = os.path.realpath(base)
    candidate = os.path.realpath(os.path.join(base_real, name))
    try:
        if os.path.commonpath((base_real, candidate)) != base_real:
            return None
    except ValueError:
        return None
    return candidate


def setup_path(save_path: str, name: str) -> str | None:
    """Resolve ``<save_path>/<name>/setup.json`` for a valid workspace."""
    if name == "default":
        return None
    if not _WORKSPACE_NAME_RE.match(str(name or "")):
        return None
    workspace_dir = _safe_join(save_path, name)
    if workspace_dir is None:
        return None
    return os.path.join(workspace_dir, "setup.json")


def load_setup(save_path: str, name: str) -> dict[str, Any]:
    """Read and merge setup defaults; malformed or missing files use defaults."""
    path = setup_path(save_path, name)
    if path is None or not os.path.isfile(path):
        return dict(DEFAULT_PROJECT_SETUP)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.loads(handle.read() or "{}")
    except (OSError, ValueError):
        return dict(DEFAULT_PROJECT_SETUP)
    if not isinstance(raw, dict):
        return dict(DEFAULT_PROJECT_SETUP)
    merged = dict(DEFAULT_PROJECT_SETUP)
    for key, value in raw.items():
        if key in merged:
            merged[key] = value
    return merged


def _validate_setup(name: str, setup: dict[str, Any]) -> dict[str, Any]:
    if name == "default":
        raise WorkspaceSetupError(400, "The default workspace cannot hold a custom project setup.")
    if not _WORKSPACE_NAME_RE.match(str(name or "")):
        raise WorkspaceSetupError(400, "Invalid workspace name.")
    if not isinstance(setup, dict):
        raise WorkspaceSetupError(400, "Setup payload must be a JSON object.")

    sanitized: dict[str, Any] = {}
    for key in DEFAULT_PROJECT_SETUP:
        if key not in setup:
            continue
        value = setup[key]
        if key in _STRING_FIELDS:
            if value is None or isinstance(value, str):
                sanitized[key] = value if value is not None else ""
            else:
                raise WorkspaceSetupError(400, f"{key} must be a string or null.")
        elif key in _BOOL_FIELDS:
            if not isinstance(value, bool):
                raise WorkspaceSetupError(400, f"{key} must be a boolean.")
            sanitized[key] = value
        elif key == "music_source":
            if value not in {"upload", "generate"}:
                raise WorkspaceSetupError(400, "music_source must be 'upload' or 'generate'.")
            sanitized[key] = value
        elif key == "director_skill":
            if value not in {"music_video", "short_film"}:
                raise WorkspaceSetupError(400, "director_skill must be 'music_video' or 'short_film'.")
            sanitized[key] = value
        elif key == "cover_image":
            if value is None or value == "":
                sanitized[key] = ""
            elif (isinstance(value, str) and _COVER_FILENAME_RE.match(value)
                    and os.path.splitext(value)[1].lower() in COVER_IMAGE_EXTENSIONS):
                sanitized[key] = value
            else:
                raise WorkspaceSetupError(400, "cover_image must be a previously uploaded cover filename.")
        elif key in _LIST_STRING_FIELDS:
            if not isinstance(value, list) or not all(isinstance(tag, str) for tag in value):
                raise WorkspaceSetupError(400, f"{key} must be an array of strings.")
            sanitized[key] = value
        elif key in _OBJECT_FIELDS:
            if value is None or isinstance(value, dict):
                sanitized[key] = value if value is not None else {}
            else:
                raise WorkspaceSetupError(400, f"{key} must be an object.")
        elif key == "schema_version":
            if not isinstance(value, int):
                raise WorkspaceSetupError(400, "schema_version must be an integer.")
            sanitized[key] = value
    sanitized.setdefault("schema_version", DEFAULT_PROJECT_SETUP["schema_version"])
    return sanitized


def persist_setup(save_path: str, name: str, setup: dict[str, Any]) -> dict[str, Any]:
    """Validate and atomically persist one workspace setup."""
    sanitized = _validate_setup(name, setup)
    path = setup_path(save_path, name)
    if path is None:
        raise WorkspaceSetupError(400, "Invalid workspace path.")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary_path = path + ".tmp"
    try:
        with open(temporary_path, "w", encoding="utf-8") as handle:
            json.dump(sanitized, handle, indent=2)
        os.replace(temporary_path, path)
    except OSError as exc:
        try:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
        except OSError:
            pass
        raise WorkspaceSetupError(500, f"Could not persist setup: {exc}") from exc
    return sanitized


def _cover_directory(save_path: str, name: str) -> str | None:
    """Resolve the workspace folder that holds the cover image.

    Returns None for the default workspace and invalid names — covers
    only exist for real projects with a setup.json.
    """
    path = setup_path(save_path, name)
    if path is None:
        return None
    return os.path.dirname(path)


def save_cover_image(save_path: str, name: str, data: bytes, filename: str) -> str:
    """Store one project cover image and return the stored filename.

    The file lands next to setup.json under a unique ``cover_<id>.<ext>``
    name so replacing the cover naturally cache-busts the card URL.
    Replacing an old cover is the caller's job (delete the previous
    filename after the new setup.json persists) so a failed persist
    never destroys the previous cover.
    """
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise WorkspaceSetupError(400, "Cover image is empty.")
    if len(data) > MAX_COVER_IMAGE_BYTES:
        raise WorkspaceSetupError(413, "Cover image too large (max 10 MB).")
    directory = _cover_directory(save_path, name)
    if directory is None:
        raise WorkspaceSetupError(400, "Cover images are only supported for named projects.")
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in COVER_IMAGE_EXTENSIONS:
        raise WorkspaceSetupError(415, "Cover image must be a .png, .jpg, .jpeg, .webp or .bmp file.")
    os.makedirs(directory, exist_ok=True)
    stored = f"cover_{uuid.uuid4().hex[:8]}{ext}"
    temporary_path = os.path.join(directory, stored + ".tmp")
    try:
        with open(temporary_path, "wb") as handle:
            handle.write(bytes(data))
        os.replace(temporary_path, os.path.join(directory, stored))
    except OSError as exc:
        try:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
        except OSError:
            pass
        raise WorkspaceSetupError(500, f"Could not store cover image: {exc}") from exc
    return stored


def delete_cover_image(save_path: str, name: str, filename: str | None = None) -> bool:
    """Remove cover files. With a filename only that file goes, otherwise
    every ``cover.*`` leftover. Returns True when anything was removed."""
    directory = _cover_directory(save_path, name)
    if directory is None or not os.path.isdir(directory):
        return False
    removed = False
    if filename:
        if not _COVER_FILENAME_RE.match(filename):
            return False
        candidate = os.path.realpath(os.path.join(os.path.realpath(directory), filename))
        if candidate != os.path.realpath(directory) and candidate.startswith(os.path.realpath(directory) + os.sep) and os.path.isfile(candidate):
            try:
                os.remove(candidate)
                removed = True
            except OSError:
                pass
        return removed
    try:
        entries = os.listdir(directory)
    except OSError:
        return False
    for entry in entries:
        if not entry.startswith("cover_"):
            continue
        candidate = os.path.join(directory, entry)
        if os.path.isfile(candidate):
            try:
                os.remove(candidate)
                removed = True
            except OSError:
                continue
    return removed


def cover_image_path(save_path: str, name: str, filename: str) -> str | None:
    """Resolve an uploaded cover file, or None when missing/invalid."""
    directory = _cover_directory(save_path, name)
    if directory is None or not filename or not _COVER_FILENAME_RE.match(filename):
        return None
    if os.path.splitext(filename)[1].lower() not in COVER_IMAGE_EXTENSIONS:
        return None
    base_real = os.path.realpath(directory)
    candidate = os.path.realpath(os.path.join(base_real, filename))
    if candidate != base_real and candidate.startswith(base_real + os.sep) and os.path.isfile(candidate):
        return candidate
    return None
def migrate_setup(name: str) -> None:
    """Migrate legacy per-workspace setup.json into the new schema v1.

    Legacy Cue Studio used a flat ``setup.json`` in each workspace folder,
    keyed by ``workspace_name``. The new storage model stores one file
    per project with a single root ``default/workspace/default/setup.json``.

    This function is idempotent and safe to run on every launch:
    - If the legacy key exists, it is copied into the default workspace.
      If the destination already holds data, it is overwritten (the legacy
      file is considered stale).
    - The new location is normalized: the workspace name from the old flat
      file is preserved but trimmed of trailing slashes so it survives
      Windows junctions and case-normalized mounts.
    - A migration log records whether any copy took place; this avoids
      repeating the filesystem read if a user opens another project tab
      in the same session. The log itself never leaves the current Python
      process scope, so there is no risk of stale state persisting between
      runs — each launch re-reads the disk and decides afresh.
    - On first boot after an upgrade, ``migrate_setup`` writes a new
      migration log into the outputs folder so that subsequent launches
      skip the read. After that, each launch reads the fresh file from
      disk again to decide whether to migrate or not. The log is always
      written before being read back, so concurrent runs never see a
      partially-written state.
    """
    base = os.path.abspath(_projects_root())

    # 1. Resolve the legacy flat file path under outputs/legacy/
    legacy_path = os.path.join(base, ".legacy", "setup.json")

    # 2. Normalize the destination path using setup_path() which handles
    #    symlinks/junctions and rejects traversal attempts.
    new_path = setup_path(base, name)
    if not new_path:
        raise WorkspaceSetupError(409, "No legacy setup.json found to migrate.")

    # 3. Ensure the destination directory exists (legacy file may live next
    #    to setup.json in the same folder). The new location is always
    #    guaranteed to be a subfolder of base so we can create it freely.
    os.makedirs(os.path.dirname(new_path), exist_ok=True)

    # 4. If the legacy source does not exist, nothing to migrate.
    if not os.path.isfile(legacy_path):
        return

    # 5. Copy the legacy file atomically into the new location using a temp
    #    file and rename-on-success pattern. This prevents partial writes
    #    from being visible when another process (or another launch) reads
    #    the directory between open() and write().
    temp_path = os.path.join(os.path.dirname(new_path), "setup.json.tmp")

    try:
        with open(legacy_path, "r", encoding="utf-8") as src:
            legacy_raw = src.read()
        with open(temp_path, "w", encoding="utf-8") as dst:
            dst.write(legacy_raw)

        # Atomic rename — on Windows this crosses filesystem boundaries if
        # the junction is followed, but that is fine because we already know
        # legacy_path points to a valid file. On Unix this is an in-place
        # replacement. Either way the effect is "old file gone, new one here".
        os.replace(temp_path, new_path)

    except OSError as exc:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except OSError:
            pass  # ignore leftover temp on cleanup failure

    print(f"[Migrate] Legacy setup.json migrated to {new_path}")





