"""Video Editor read-model and operations (Phase D-min of HocusPocus migration).

A "Video Editor project" is a durable timeline of clips. Each clip
references an existing media file (gallery, upload, or generated)
and carries trim metadata (start/end in seconds). The editor
supports:

  - listing + creating + deleting projects
  - adding, reordering, removing clips within a project
  - trim / split operations on individual clips
  - exporting the timeline to a single mp4 via ffmpeg concat

This is a **backend-only** preview (v2.5.0). The UI lives in a separate
follow-up effort because it is a 4-5 sprint undertaking on its own —
see docs/MIGRATION_HOCUSPOCUS.md Phase D for the rationale.

The implementation reuses ``app.wgp.concatenate_multi_clip_videos`` so we
inherit the same ffmpeg concat-FILTER path the Director pipeline already
trusts (re-encodes to uniform format, no silent demuxer drops).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
import uuid
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

log = logging.getLogger("cue_studio.video_editor")


__all__ = [
    "VideoEditor",
    "EditorError",
    "PROJECT_STATES",
]


# ----------------------------------------------------------------- errors


class EditorError(ValueError):
    """Raised when an editor operation is invalid."""


# ----------------------------------------------------------------- state


PROJECT_STATES = frozenset({"prepared", "running", "completed", "failed", "cancelled"})


# ----------------------------------------------------------------- persistence


def _default_root() -> Path:
    """Where editor projects are persisted."""
    config_dir = os.environ.get("CUE_CONFIG_DIR", "").strip() or os.path.join(
        os.path.expanduser("~"), ".cue_studio",
    )
    return Path(config_dir) / "editor"


def _safe_id() -> str:
    return uuid.uuid4().hex[:12]


def _coerce_positive_seconds(value: Any, *, default: float = 0.0) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if v != v or v < 0:  # NaN or negative
        return default
    return v


def _clean_clip(clip: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize one clip entry. Defensive against malformed input."""
    media_path = str(clip.get("media_path") or clip.get("path") or "").strip()
    if not media_path:
        raise EditorError("clip.media_path is required")
    start = _coerce_positive_seconds(clip.get("start"))
    end = clip.get("end")
    if end is None:
        end = start
    else:
        end = _coerce_positive_seconds(end)
    if end < start:
        end = start
    return {
        "id": str(clip.get("id") or _safe_id()),
        "media_path": media_path,
        "start": start,
        "end": end,
        "label": str(clip.get("label") or "").strip()[:200] or None,
        "audio_gain": float(clip.get("audio_gain") or 1.0),
    }


def _clean_project(project: Mapping[str, Any]) -> dict[str, Any]:
    state = str(project.get("state") or "prepared")
    if state not in PROJECT_STATES:
        state = "prepared"
    clips_raw = list(project.get("clips") or [])
    clips = [_clean_clip(c) for c in clips_raw if isinstance(c, Mapping)]
    return {
        "id": str(project.get("id") or _safe_id()),
        "title": str(project.get("title") or "").strip()[:200] or "Untitled",
        "state": state,
        "created_at": float(project.get("created_at") or time.time()),
        "updated_at": float(project.get("updated_at") or time.time()),
        "clips": clips,
        "output_path": str(project.get("output_path") or "").strip() or None,
        "error": str(project.get("error") or "").strip() or None,
    }


# ----------------------------------------------------------------- VideoEditor


class VideoEditor:
    """Thread-safe video editor backed by a JSON file per project.

    Files live under ``<CUE_CONFIG_DIR>/editor/<id>.json``. Each project
    is a small JSON document; we read/write the whole file per call to
    keep the surface tiny (the editor is not a hot path).
    """

    def __init__(self, root: Path | None = None) -> None:
        self._root = root or _default_root()
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    @property
    def root(self) -> Path:
        return self._root

    # ---------------------------------------------------------- persistence

    def _path_for(self, project_id: str) -> Path:
        # Reject path traversal early.
        if "/" in project_id or "\\" in project_id or ".." in project_id:
            raise EditorError("Invalid project id")
        return self._root / f"{project_id}.json"

    def _load(self, project_id: str) -> dict[str, Any] | None:
        path = self._path_for(project_id)
        if not path.exists():
            return None
        try:
            with path.open(encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, ValueError):
            return None
        if not isinstance(raw, Mapping):
            return None
        return _clean_project(raw)

    def _save(self, project: dict[str, Any]) -> None:
        project["updated_at"] = time.time()
        path = self._path_for(project["id"])
        tmp = path.with_suffix(".json.tmp")
        try:
            with tmp.open("w", encoding="utf-8") as f:
                json.dump(project, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except Exception:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            raise

    # ------------------------------------------------------------------ CRUD

    def list_projects(self, *, limit: int = 50) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 200))
        with self._lock:
            files = sorted(
                self._root.glob("*.json"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            projects = []
            for path in files[:limit]:
                pid = path.stem
                project = self._load(pid)
                if project is not None:
                    projects.append(project)
            return projects

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._load(project_id)

    def create_project(self, *, title: str = "Untitled") -> dict[str, Any]:
        project = _clean_project({"id": _safe_id(), "title": title})
        with self._lock:
            self._save(project)
        return project

    def delete_project(self, project_id: str) -> bool:
        with self._lock:
            path = self._path_for(project_id)
            if not path.exists():
                return False
            try:
                path.unlink()
            except OSError:
                return False
            return True

    # --------------------------------------------------------------- clips

    def add_clip(
        self, project_id: str, clip: Mapping[str, Any],
    ) -> dict[str, Any]:
        with self._lock:
            project = self._load(project_id)
            if project is None:
                raise EditorError(f"Project not found: {project_id}")
            new_clip = _clean_clip(clip)
            project["clips"].append(new_clip)
            project["state"] = "prepared"
            self._save(project)
            return project

    def remove_clip(self, project_id: str, clip_id: str) -> dict[str, Any]:
        with self._lock:
            project = self._load(project_id)
            if project is None:
                raise EditorError(f"Project not found: {project_id}")
            before = len(project["clips"])
            project["clips"] = [c for c in project["clips"] if c.get("id") != clip_id]
            if len(project["clips"]) == before:
                raise EditorError(f"Clip not found: {clip_id}")
            self._save(project)
            return project

    def reorder_clips(
        self, project_id: str, order: Iterable[str],
    ) -> dict[str, Any]:
        """Reorder clips by id. ``order`` is the new sequence of clip ids."""
        with self._lock:
            project = self._load(project_id)
            if project is None:
                raise EditorError(f"Project not found: {project_id}")
            by_id = {c["id"]: c for c in project["clips"]}
            new_clips = []
            seen: set[str] = set()
            for cid in order:
                if cid in by_id and cid not in seen:
                    new_clips.append(by_id[cid])
                    seen.add(cid)
            # Append any clips that weren't mentioned in the order, preserving
            # the original sequence.
            for c in project["clips"]:
                if c["id"] not in seen:
                    new_clips.append(c)
                    seen.add(c["id"])
            project["clips"] = new_clips
            self._save(project)
            return project

    def trim_clip(
        self, project_id: str, clip_id: str, *, start: float, end: float,
    ) -> dict[str, Any]:
        with self._lock:
            project = self._load(project_id)
            if project is None:
                raise EditorError(f"Project not found: {project_id}")
            for clip in project["clips"]:
                if clip.get("id") == clip_id:
                    clip["start"] = _coerce_positive_seconds(start)
                    clip["end"] = _coerce_positive_seconds(end)
                    if clip["end"] < clip["start"]:
                        clip["end"] = clip["start"]
                    self._save(project)
                    return project
            raise EditorError(f"Clip not found: {clip_id}")

    def split_clip(
        self, project_id: str, clip_id: str, *, at_seconds: float,
    ) -> dict[str, Any]:
        """Split one clip into two at ``at_seconds`` (relative to the original)."""
        with self._lock:
            project = self._load(project_id)
            if project is None:
                raise EditorError(f"Project not found: {project_id}")
            for index, clip in enumerate(project["clips"]):
                if clip.get("id") != clip_id:
                    continue
                start, end = clip["start"], clip["end"]
                if at_seconds <= start or at_seconds >= end:
                    raise EditorError("split point must lie strictly inside the clip")
                left = dict(clip)
                left["end"] = at_seconds
                right = dict(clip)
                right["id"] = _safe_id()
                right["start"] = at_seconds
                project["clips"][index:index + 1] = [left, right]
                self._save(project)
                return project
            raise EditorError(f"Clip not found: {clip_id}")

    # --------------------------------------------------------------- export

    def export(self, project_id: str, output_path: str | None = None) -> dict[str, Any]:
        """Concatenate the project's clips into one mp4 via ffmpeg concat FILTER.

        Returns the updated project with ``output_path`` set.
        """
        with self._lock:
            project = self._load(project_id)
            if project is None:
                raise EditorError(f"Project not found: {project_id}")
            clips = list(project.get("clips") or [])
            if not clips:
                raise EditorError("Cannot export a project with no clips")

            target = Path(output_path) if output_path else self._root / f"{project['id']}.mp4"
            target.parent.mkdir(parents=True, exist_ok=True)
            # Build the ffmpeg command via the trusted wgp helper.
            try:
                from app import wgp  # type: ignore
                ok = wgp.concatenate_multi_clip_videos(
                    clip_paths=[c["media_path"] for c in clips],
                    output_path=str(target),
                )
            except Exception as exc:
                project["state"] = "failed"
                project["error"] = f"export failed: {exc}"
                self._save(project)
                raise EditorError(f"export failed: {exc}") from exc

            if not ok:
                project["state"] = "failed"
                project["error"] = "ffmpeg concatenation returned False"
                self._save(project)
                raise EditorError("ffmpeg concatenation failed")

            project["state"] = "completed"
            project["output_path"] = str(target)
            project["error"] = None
            self._save(project)
            return project

    # ----------------------------------------------------------- probes

    def ffmpeg_available(self) -> bool:
        """Return whether the ffmpeg binary is reachable."""
        return shutil.which(os.environ.get("FFMPEG_BINARY", "ffmpeg")) is not None

    def ffprobe_duration(self, media_path: str) -> float | None:
        """Best-effort duration probe (seconds) for a media file."""
        ffprobe = shutil.which("ffprobe")
        if not ffprobe:
            return None
        try:
            result = subprocess.run(
                [
                    ffprobe,
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    media_path,
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        try:
            return float(result.stdout.strip())
        except (TypeError, ValueError):
            return None
