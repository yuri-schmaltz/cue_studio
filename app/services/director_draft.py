"""Persistence for per-workspace Director planning drafts.

Stores the in-progress Director planning state (audio path, audio analysis,
planned clips, clip plans, scene description, step, etc.) under
``<save_path>/<workspace>/director_draft.json`` so that unsubmitted planning
survives browser refreshes, hard reloads, and network interruptions.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any


class DirectorDraftError(Exception):
    """Validation or persistence failure with an HTTP-compatible status."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


_WORKSPACE_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
MAX_DRAFT_BYTES = 20 * 1024 * 1024  # 20 MB ceiling for huge long-form stories


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


def draft_path(save_path: str, name: str) -> str | None:
    """Resolve ``<save_path>/<name>/director_draft.json`` for a valid workspace."""
    str_name = str(name or "").strip()
    if not str_name:
        return None
    if str_name == "default":
        return os.path.join(os.path.realpath(save_path), "director_draft.json")
    if not _WORKSPACE_NAME_RE.match(str_name):
        return None
    workspace_dir = _safe_join(save_path, str_name)
    if workspace_dir is None:
        return None
    return os.path.join(workspace_dir, "director_draft.json")


def load_draft(save_path: str, name: str) -> dict[str, Any] | None:
    """Read saved draft; returns None if file is missing, empty, or unreadable."""
    path = draft_path(save_path, name)
    if path is None or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.loads(handle.read() or "null")
    except (OSError, ValueError):
        return None
    if isinstance(raw, dict):
        return raw
    return None


def save_draft(save_path: str, name: str, draft: dict[str, Any]) -> dict[str, Any]:
    """Validate and atomically persist one workspace director draft."""
    if not isinstance(draft, dict):
        raise DirectorDraftError(400, "Draft payload must be a JSON object.")
    path = draft_path(save_path, name)
    if path is None:
        raise DirectorDraftError(400, "Invalid workspace name or path.")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary_path = path + ".tmp"
    try:
        serialized = json.dumps(draft, indent=2, ensure_ascii=False)
        if len(serialized.encode("utf-8")) > MAX_DRAFT_BYTES:
            raise DirectorDraftError(413, "Director draft payload exceeds maximum size limit.")
        with open(temporary_path, "w", encoding="utf-8") as handle:
            handle.write(serialized)
        os.replace(temporary_path, path)
    except DirectorDraftError:
        try:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
        except OSError:
            pass
        raise
    except OSError as exc:
        try:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
        except OSError:
            pass
        raise DirectorDraftError(500, f"Could not persist director draft: {exc}") from exc
    return draft


def delete_draft(save_path: str, name: str) -> bool:
    """Remove draft file if present. Returns True if removed, False otherwise."""
    path = draft_path(save_path, name)
    if path is None or not os.path.isfile(path):
        return False
    try:
        os.remove(path)
        return True
    except OSError:
        return False
