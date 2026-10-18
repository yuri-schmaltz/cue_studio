"""Post-restart job classification and resume orchestration (A19).

Server restarts used to leave Director jobs in an ambiguous state: the
``runs`` table kept ``running`` rows forever and the UI had no way to tell
a finished job (media already on disk) from one that died mid-generation.
This module answers, per job:

* ``done``       — the expected media is on the filesystem;
* ``interrupted``— media is partial or the persisted state was non-terminal;
* ``failed``     — an error was recorded;
* ``unknown``     — no persisted record and no media.

The contract mirrors the spec
(``_reversa_forward/plano-2026-10-04/25-feature-a19-resume.md``) with one
adaptation: the real "queue" is the ``runs`` table of
:mod:`services.production_store` (there is no ``app.state.queue`` table),
so ``classify`` accepts any :class:`ProductionStore`-shaped object and
looks jobs up by run id, production id, or the legacy
``correlations.pipeline_id`` bridge.

Resume is idempotent on three levels:

1. ``done`` jobs are never re-dispatched (no duplicate media);
2. an ``Idempotency-Key`` (explicit header/body key or a stable hash of
   the job id) replays the recorded result of a previous resume instead
   of dispatching again;
3. the underlying ``director_pipeline.resume_pipeline`` already skips
   completed stages, so an interrupted run continues from its checkpoint.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .job_lifecycle import GENERATED_MEDIA_EXTENSIONS

log = logging.getLogger("cue_studio.job_classifier")

__all__ = [
    "DONE",
    "FAILED",
    "INTERRUPTED",
    "JobState",
    "QueueResumeService",
    "UNKNOWN",
    "classify",
    "classify_all",
]

DONE = "done"
INTERRUPTED = "interrupted"
FAILED = "failed"
UNKNOWN = "unknown"

# Non-terminal statuses that mean "the server died while this was active".
_ACTIVE_STATUSES = ("running", "queued", "held")

# Media search is bounded: workspace trees nest a few levels (workspace /
# clips / stage folders) but scanning a whole outputs drive on every queue
# poll would be wasteful.
_MAX_MEDIA_DEPTH = 4


@dataclass(frozen=True)
class JobState:
    """Classified post-restart state of one job (spec contract type)."""

    id: str
    status: str
    media_path: Path | None
    can_resume: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "media_path": str(self.media_path) if self.media_path else None,
            "can_resume": self.can_resume,
        }


# ----------------------------------------------------------------- lookup


def _find_run(db: Any, job_id: str) -> dict[str, Any] | None:
    """Latest raw run row for a run/production/pipeline id, if any."""
    finder = getattr(db, "find_run", None)
    if callable(finder):
        return finder(job_id)
    # Duck-typed fallback for store-likes without find_run().
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM runs
            WHERE id = ?
               OR production_id = ?
               OR json_extract(correlations, '$.pipeline_id') = ?
            ORDER BY attempt DESC, updated_at DESC
            LIMIT 1
            """,
            (job_id, job_id, job_id),
        ).fetchone()
    return dict(row) if row is not None else None


def _find_media(fs_root: Path | str, tokens: tuple[str, ...]) -> list[Path]:
    """Media files under ``fs_root`` whose path references a job token."""
    root = Path(fs_root)
    if not root.is_dir() or not tokens:
        return []
    found: list[Path] = []
    base_depth = len(root.parts)
    for dirpath, _dirnames, filenames in os.walk(root):
        if len(Path(dirpath).parts) - base_depth >= _MAX_MEDIA_DEPTH:
            continue
        for filename in filenames:
            extension = os.path.splitext(filename)[1].lower()
            if extension not in GENERATED_MEDIA_EXTENSIONS:
                continue
            candidate = Path(dirpath) / filename
            relative = str(candidate.relative_to(root))
            if any(token and token in relative for token in tokens):
                found.append(candidate)
    return sorted(found)


def _run_tokens(run: Mapping[str, Any], job_id: str) -> tuple[str, ...]:
    tokens = [job_id]
    correlations = run.get("correlations")
    if isinstance(correlations, str):
        try:
            import json

            correlations = json.loads(correlations)
        except ValueError:
            correlations = None
    if isinstance(correlations, Mapping):
        for key in ("pipeline_id", "job_id", "task_id"):
            value = correlations.get(key)
            if isinstance(value, str) and value:
                tokens.append(value)
    return tuple(dict.fromkeys(tokens))


# ------------------------------------------------------------- classify


def classify(job_id: str, db: Any, fs_root: Path | str) -> JobState:
    """Classify one job after a restart (spec contract).

    Consults the persisted run (DB) and the filesystem under ``fs_root``:

    * ``failed``      — an error is recorded (or status ``failed``);
    * ``done``        — status completed with all expected media present
      (or media found even without a DB record);
    * ``interrupted`` — media is partial, or the persisted state was
      non-terminal (``running``/``queued``/``held``/``interrupted``);
    * ``unknown``     — no record and no media.
    """
    run = _find_run(db, job_id)
    tokens = _run_tokens(run or {}, job_id)
    media = _find_media(fs_root, tokens)
    media_path = media[0].parent if media else None

    if run is None:
        if media:
            return JobState(job_id, DONE, media_path, False)
        return JobState(job_id, UNKNOWN, None, False)

    status = str(run.get("status") or "").casefold()
    error = run.get("error")
    try:
        expected = max(0, int(run.get("output_count") or 0))
    except (TypeError, ValueError):
        expected = 0

    if error or status == FAILED:
        return JobState(job_id, FAILED, media_path, True)

    if status == "completed":
        if expected == 0 or len(media) >= expected:
            return JobState(job_id, DONE, media_path, False)
        return JobState(job_id, INTERRUPTED, media_path, True)

    if status in _ACTIVE_STATUSES or status == INTERRUPTED:
        return JobState(job_id, INTERRUPTED, media_path, True)

    return JobState(job_id, UNKNOWN, media_path, False)


def classify_all(db: Any, fs_root: Path | str, *, limit: int = 100) -> list[JobState]:
    """Classify the latest run of every production (the post-restart queue)."""
    states: list[JobState] = []
    seen: set[str] = set()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id FROM productions ORDER BY updated_at DESC LIMIT ?",
            (max(1, min(int(limit), 500)),),
        ).fetchall()
    for row in rows:
        production_id = row["id"] if isinstance(row, Mapping) else row[0]
        latest = _find_run(db, production_id)
        if latest is None:
            continue
        run_id = latest.get("id") or production_id
        if run_id in seen:
            continue
        seen.add(run_id)
        workspace = str(latest.get("workspace_id") or "default")
        run_root = os.path.join(str(fs_root), workspace)
        states.append(classify(str(run_id), db, run_root if os.path.isdir(run_root) else fs_root))
    return states


# --------------------------------------------------------- resume service


class QueueResumeService:
    """Idempotent resume orchestration for the queue endpoints (A19).

    ``resume`` is an optional callable ``(pipeline_id, out_dir) -> result``
    where result is either a ``(ok, message)`` tuple, an object with
    ``ok``/``message`` attributes (e.g. ``ResumeResult``), or a mapping
    with those keys. Defaults to
    ``services.production_resume.ProductionResume.resume_production`` so
    tests can inject a fake without importing the WanGP stack.
    """

    _IDEMPOTENCY_WINDOW_SECONDS = 600

    def __init__(self, store: Any, *, fs_root: Path | str = ".", resume=None) -> None:
        self._store = store
        self._fs_root = Path(fs_root) if fs_root else Path(".")
        self._resume = resume

    # ------------------------------------------------------------- read

    def list_jobs(self, *, limit: int = 100) -> list[dict[str, Any]]:
        """Every persisted job with its post-restart state."""
        states = classify_all(self._store, self._fs_root, limit=limit)
        jobs: list[dict[str, Any]] = []
        for state in states:
            entry = state.to_dict()
            run = _find_run(self._store, state.id)
            if run is not None:
                entry["production_id"] = run.get("production_id")
                entry["attempt"] = run.get("attempt")
                entry["title"] = None
                entry["interrupted_at"] = run.get("interrupted_at")
                production = None
                getter = getattr(self._store, "get_production", None)
                if callable(getter):
                    production = getter(run.get("production_id"))
                entry["title"] = (production or {}).get("title")
            jobs.append(entry)
        return jobs

    def classify_job(self, job_id: str) -> JobState:
        return classify(job_id, self._store, self._fs_root)

    # ----------------------------------------------------------- resume

    def resume_job(
        self,
        job_id: str,
        *,
        out_dir: str = "default",
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Resume one job. Idempotent — see module docstring.

        Returns a dict envelope::

            {"ok": bool, "status": str, "skipped": bool, "replayed": bool,
             "message": str, "idempotency_key": str, ...}
        """
        state = self.classify_job(job_id)

        if state.status == UNKNOWN:
            return {
                "ok": False,
                "status": UNKNOWN,
                "skipped": False,
                "replayed": False,
                "message": "Unknown job — nothing recorded to resume.",
                "idempotency_key": idempotency_key or "",
            }

        if state.status == DONE:
            # Restart must never re-execute finished output (A19).
            return {
                "ok": True,
                "status": DONE,
                "skipped": True,
                "replayed": False,
                "message": "Job already done — resume skipped.",
                "media_path": str(state.media_path) if state.media_path else None,
                "idempotency_key": idempotency_key or "",
            }

        key = idempotency_key or self._default_key(job_id)

        replay = self._find_recorded_resume(key)
        if replay is not None:
            return {
                "ok": bool(replay.get("ok", False)),
                "status": state.status,
                "skipped": False,
                "replayed": True,
                "message": str(replay.get("message", "Resume already accepted.")),
                "run_id": replay.get("run_id"),
                "production_id": replay.get("production_id"),
                "attempt": replay.get("attempt"),
                "idempotency_key": key,
            }

        result = self._dispatch(job_id, out_dir)
        payload = {
            "job_id": job_id,
            "out_dir": out_dir,
            "ok": bool(result.get("ok")),
            "message": str(result.get("message", "")),
            "run_id": result.get("run_id"),
            "production_id": result.get("production_id"),
            "attempt": result.get("attempt"),
            "idempotency_key": key,
            "previous_status": state.status,
        }
        append = getattr(self._store, "append_event", None)
        if callable(append):
            try:
                append(
                    production_id=result.get("production_id"),
                    run_id=result.get("run_id"),
                    kind="queue.resume",
                    payload=payload,
                )
            except Exception:  # pragma: no cover - audit must not break resume
                log.exception("[queue-resume] could not record event for %s", job_id)

        return {
            "ok": bool(result.get("ok")),
            "status": state.status,
            "skipped": False,
            "replayed": False,
            "message": str(result.get("message", "")),
            "run_id": result.get("run_id"),
            "production_id": result.get("production_id"),
            "attempt": result.get("attempt"),
            "idempotency_key": key,
        }

    # --------------------------------------------------------- internals

    @staticmethod
    def _default_key(job_id: str) -> str:
        return hashlib.sha256(f"queue.resume:{job_id}".encode("utf-8")).hexdigest()[:16]

    def _find_recorded_resume(self, key: str) -> Mapping[str, Any] | None:
        lister = getattr(self._store, "list_events", None)
        if not callable(lister):
            return None
        cutoff = time.time() - self._IDEMPOTENCY_WINDOW_SECONDS
        try:
            events = lister(limit=200)
        except Exception:  # pragma: no cover - defensive
            return None
        for event in events:
            if event.get("kind") != "queue.resume":
                continue
            if float(event.get("created_at") or 0) < cutoff:
                continue
            payload = event.get("payload") or {}
            if payload.get("idempotency_key") == key:
                return payload
        return None

    def _dispatch(self, job_id: str, out_dir: str) -> dict[str, Any]:
        resume_fn = self._resume
        if resume_fn is None:
            # Local import: production_resume pulls the (heavy) pipeline
            # module lazily and this service must stay importable early.
            from .production_resume import ProductionResume

            facade = ProductionResume(store=self._store)
            resume_fn = lambda pid, od: facade.resume_production(pipeline_id=pid, out_dir=od)  # noqa: E731
        try:
            outcome = resume_fn(job_id, out_dir)
        except Exception as exc:
            log.exception("[queue-resume] resume raised for %s", job_id)
            return {"ok": False, "message": f"Resume raised: {exc}"}
        if isinstance(outcome, tuple) and len(outcome) == 2:
            return {"ok": bool(outcome[0]), "message": str(outcome[1])}
        if isinstance(outcome, Mapping):
            return dict(outcome)
        ok = bool(getattr(outcome, "ok", False))
        message = str(getattr(outcome, "message", ""))
        return {
            "ok": ok,
            "message": message,
            "run_id": getattr(outcome, "run_id", None),
            "production_id": getattr(outcome, "production_id", None),
            "attempt": getattr(outcome, "attempt", None),
        }
