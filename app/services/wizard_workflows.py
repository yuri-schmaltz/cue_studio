"""Durable per-workspace Wizard workflows for Cue Studio.

Port of ``hocuspocus/services/wizard_workflows.py``. The file stores
orchestration checkpoints, never executable code. Creative steps are
resolved by the UI's registered workflow definition after reload;
mechanical state and canonical task correlation survive process restarts.

Stored in ``<CUE_CONFIG_DIR>/.wizard-workflows-v1.json`` with atomic
write + revision counter for optimistic concurrency.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Mapping


WORKFLOW_FILENAME = ".wizard-workflows-v1.json"
MAX_WORKFLOWS = 100
MAX_STEPS = 100
MAX_BYTES = 4 * 1024 * 1024
_LOCK = threading.RLock()


WORKFLOW_STATES = frozenset({
    "prepared", "queued", "waiting", "running", "completed",
    "awaiting_input", "partial", "failed", "retrying", "cancelled",
})
STEP_STATES = frozenset({
    "pending", "running", "waiting", "awaiting_input",
    "completed", "failed", "cancelled",
})
_SENSITIVE_PARTS = (
    "api_key", "apikey", "token", "authorization", "password", "passwd",
    "secret", "cookie", "session",
)


class WizardWorkflowRevisionConflict(ValueError):
    """Raised when the persisted revision does not match the caller's expectation."""

    def __init__(self, expected: int, current: int) -> None:
        super().__init__(
            f"Wizard workflow revision conflict: expected {expected}, current {current}"
        )
        self.expected = expected
        self.current = current


def empty_workflows() -> dict[str, Any]:
    """Return a blank workflow document."""
    return {"version": 1, "revision": 0, "workflows": []}


# --------------------------------------------------------- input sanitization


def _text(value: Any, limit: int) -> str:
    """Coerce to str, drop null bytes, truncate."""
    return str(value or "").replace("\x00", "")[:limit]


def _integer(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return default


def _number(value: Any) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return value if value == value else 0  # NaN guard


def _safe_value(value: Any, depth: int = 0) -> Any:
    """Recursively sanitize a value: drop deep structures, redact sensitive keys."""
    if depth > 8:
        return None
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, str):
        return _text(value, 8_000)
    if isinstance(value, list):
        return [_safe_value(item, depth + 1) for item in value[:200]]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, sub in list(value.items())[:200]:
            key_str = _text(key, 200)
            if key_str.lower() in _SENSITIVE_PARTS:
                out[key_str] = "[redacted]"
            else:
                out[key_str] = _safe_value(sub, depth + 1)
        return out
    return _text(str(value), 200)


# ------------------------------------------------------------- step helpers


def _clean_step(step: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize one step entry. Defensive against malformed input."""
    name = _text(step.get("name"), 200)
    state = _text(step.get("state"), 32) or "pending"
    if state not in STEP_STATES:
        state = "pending"
    return {
        "name": name,
        "state": state,
        "input": _safe_value(step.get("input")),
        "output": _safe_value(step.get("output")),
        "attempts": _integer(step.get("attempts")),
        "error": _text(step.get("error"), 1000) or None,
        "started_at": _number(step.get("started_at")),
        "completed_at": _number(step.get("completed_at")),
    }


# ------------------------------------------------------------- workflow helpers


def _clean_workflow(workflow: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize one workflow entry."""
    state = _text(workflow.get("state"), 32) or "prepared"
    if state not in WORKFLOW_STATES:
        state = "prepared"
    return {
        "id": _text(workflow.get("id"), 64) or _new_id(),
        "title": _text(workflow.get("title"), 200),
        "kind": _text(workflow.get("kind"), 64) or "wizard",
        "state": state,
        "created_at": _number(workflow.get("created_at")) or _now(),
        "updated_at": _number(workflow.get("updated_at")) or _now(),
        "steps": [_clean_step(s) for s in (workflow.get("steps") or [])[:MAX_STEPS]],
        "context": _safe_value(workflow.get("context")),
        "input": _safe_value(workflow.get("input")),
        "output": _safe_value(workflow.get("output")),
        "error": _text(workflow.get("error"), 1000) or None,
        "task_id": _text(workflow.get("task_id"), 64) or None,
    }


# ------------------------------------------------------------- persistence


def _new_id() -> str:
    import uuid
    return uuid.uuid4().hex


def _now() -> float:
    import time
    return time.time()


def _default_path() -> Path:
    config_dir = os.environ.get("CUE_CONFIG_DIR", "").strip() or os.path.join(
        os.path.expanduser("~"), ".cue_studio"
    )
    return Path(config_dir) / WORKFLOW_FILENAME


def load_workflows(path: Path | None = None) -> dict[str, Any]:
    """Load the workflow document. Returns an empty doc on missing/corrupt."""
    target = path or _default_path()
    if not target.exists():
        return empty_workflows()
    try:
        with target.open(encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        return empty_workflows()
    if not isinstance(raw, dict):
        return empty_workflows()
    return _validate_document(raw)


def _validate_document(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Validate + clean an entire document."""
    if not isinstance(raw.get("workflows"), list):
        return empty_workflows()
    workflows = [_clean_workflow(w) for w in raw["workflows"] if isinstance(w, Mapping)]
    # Cap to MAX_WORKFLOWS, dropping the oldest updated_at first.
    if len(workflows) > MAX_WORKFLOWS:
        workflows.sort(key=lambda w: w.get("updated_at") or 0, reverse=True)
        workflows = workflows[:MAX_WORKFLOWS]
    return {
        "version": 1,
        "revision": _integer(raw.get("revision")),
        "workflows": workflows,
    }


def save_workflows(
    document: Mapping[str, Any],
    *,
    expected_revision: int | None = None,
    path: Path | None = None,
) -> dict[str, Any]:
    """Atomically persist the document. Bumps revision.

    Raises ``WizardWorkflowRevisionConflict`` if ``expected_revision`` is
    provided and does not match the current on-disk revision.
    """
    target = path or _default_path()
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)

    with _LOCK:
        current = load_workflows(target)
        if expected_revision is not None and current["revision"] != expected_revision:
            raise WizardWorkflowRevisionConflict(expected_revision, current["revision"])

        new_revision = current["revision"] + 1
        cleaned = _validate_document({**dict(document), "revision": new_revision})

        # Atomic write: tmp + fsync + os.replace
        suffix = os.urandom(3).hex()
        tmp = target.with_name(f".{target.name}.{suffix}.tmp")
        try:
            with tmp.open("w", encoding="utf-8") as handle:
                json.dump(cleaned, handle, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, target)
        except Exception:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            raise
    return cleaned


def upsert_workflow(workflow: Mapping[str, Any]) -> dict[str, Any]:
    """Insert or replace one workflow by id. Bumps revision."""
    cleaned = _clean_workflow(workflow)
    with _LOCK:
        document = load_workflows()
        workflows = [w for w in document["workflows"] if w["id"] != cleaned["id"]]
        workflows.append(cleaned)
        return save_workflows({"workflows": workflows})


def delete_workflow(workflow_id: str) -> bool:
    """Remove a workflow. Returns True if a row was deleted."""
    with _LOCK:
        document = load_workflows()
        before = len(document["workflows"])
        workflows = [w for w in document["workflows"] if w["id"] != workflow_id]
        if len(workflows) == before:
            return False
        save_workflows({"workflows": workflows})
        return True


def get_workflow(workflow_id: str) -> dict[str, Any] | None:
    with _LOCK:
        document = load_workflows()
    for w in document["workflows"]:
        if w["id"] == workflow_id:
            return w
    return None


def list_workflows(*, limit: int = 50) -> list[dict[str, Any]]:
    with _LOCK:
        document = load_workflows()
    workflows = sorted(
        document["workflows"],
        key=lambda w: w.get("updated_at") or 0,
        reverse=True,
    )
    return workflows[: max(1, min(limit, MAX_WORKFLOWS))]


# ------------------------------------------------------------ module-level singleton


_default_lock = threading.RLock()
_default_instance: "WizardWorkflowStore | None" = None


class WizardWorkflowStore:
    """Thin facade over the on-disk JSON file with thread-safe accessors.

    The store reads from and writes to the workflow file via the module-level
    helpers; tests can inject a custom path via ``set_default_path``.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path

    @property
    def path(self) -> Path:
        return self._path or _default_path()

    def load(self) -> dict[str, Any]:
        return load_workflows(self._path)

    def save(
        self,
        document: Mapping[str, Any],
        *,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        return save_workflows(
            document, expected_revision=expected_revision, path=self._path,
        )

    def upsert(self, workflow: Mapping[str, Any]) -> dict[str, Any]:
        if self._path is None:
            return upsert_workflow(workflow)
        cleaned = _clean_workflow(workflow)
        with _LOCK:
            document = load_workflows(self._path)
            workflows = [w for w in document["workflows"] if w["id"] != cleaned["id"]]
            workflows.append(cleaned)
            return save_workflows({"workflows": workflows}, path=self._path)

    def delete(self, workflow_id: str) -> bool:
        if self._path is None:
            return delete_workflow(workflow_id)
        with _LOCK:
            document = load_workflows(self._path)
            before = len(document["workflows"])
            workflows = [w for w in document["workflows"] if w["id"] != workflow_id]
            if len(workflows) == before:
                return False
            save_workflows({"workflows": workflows}, path=self._path)
            return True

    def get(self, workflow_id: str) -> dict[str, Any] | None:
        if self._path is None:
            return get_workflow(workflow_id)
        for w in load_workflows(self._path)["workflows"]:
            if w["id"] == workflow_id:
                return w
        return None

    def list(self, *, limit: int = 50) -> list[dict[str, Any]]:
        if self._path is None:
            return list_workflows(limit=limit)
        return sorted(
            load_workflows(self._path)["workflows"],
            key=lambda w: w.get("updated_at") or 0,
            reverse=True,
        )[: max(1, min(limit, MAX_WORKFLOWS))]


def get_default() -> WizardWorkflowStore:
    """Return the lazily-initialized default store (process singleton)."""
    global _default_instance
    with _default_lock:
        if _default_instance is None:
            _default_instance = WizardWorkflowStore()
        return _default_instance


def reset_default_for_tests(instance: WizardWorkflowStore | None = None) -> None:
    """Test hook: replace (or clear) the module singleton."""
    global _default_instance
    with _default_lock:
        _default_instance = instance


__all__ = [
    "WizardWorkflowStore",
    "WizardWorkflowRevisionConflict",
    "WORKFLOW_STATES",
    "STEP_STATES",
    "get_default",
    "reset_default_for_tests",
    "load_workflows",
    "save_workflows",
    "upsert_workflow",
    "delete_workflow",
    "get_workflow",
    "list_workflows",
]
