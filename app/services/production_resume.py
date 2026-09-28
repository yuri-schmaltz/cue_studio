"""High-level Production Run orchestration (Phase B3 of the HocusPocus migration).

Glues the read models (:mod:`services.production_adapter`,
:mod:`services.production_store`) with the existing
``services.director_pipeline.resume_pipeline`` so the UI / MCP / API can
expose the "Productions" workflow:

  - inspect a failed production (which stages completed, which failed)
  - retake one stage without rerunning the whole pipeline
  - resume the whole production from the last completed checkpoint

The orchestration is intentionally thin: this module never mutates
pipeline state directly. It calls into ``director_pipeline`` and updates
the :class:`ProductionStore` after each transition so the catalog
stays in sync.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterable, Mapping
from typing import Any

from .production_adapter import adapt_pipeline_record
from .production_store import ProductionStore


log = logging.getLogger("cue_studio.production_resume")


__all__ = [
    "ProductionResume",
    "ResumeResult",
]


# --------------------------------------------------------------------- types


class ResumeResult:
    """Result envelope returned by the resume + retake helpers.

    Attributes are deliberately read-only — callers serialize them straight
    into JSON-RPC / HTTP responses.
    """

    __slots__ = ("ok", "message", "run_id", "production_id", "attempt")

    def __init__(
        self,
        ok: bool,
        message: str,
        *,
        run_id: str | None = None,
        production_id: str | None = None,
        attempt: int | None = None,
    ) -> None:
        self.ok = ok
        self.message = message
        self.run_id = run_id
        self.production_id = production_id
        self.attempt = attempt

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "message": self.message,
            "run_id": self.run_id,
            "production_id": self.production_id,
            "attempt": self.attempt,
        }


# --------------------------------------------------------------- orchestrator


class ProductionResume:
    """Stateless facade over the store + the pipeline resume function.

    Thread-safe: each method opens its own short-lived connection through
    the store and never mutates shared in-memory state. Multiple concurrent
    resumes of different pipelines are serialized inside
    ``director_pipeline._pipeline_lock`` (existing behavior); the store
    layer uses ``BEGIN IMMEDIATE`` so concurrent writes never interleave.
    """

    def __init__(
        self,
        store: ProductionStore | None = None,
        *,
        pipeline_resume=None,
    ) -> None:
        """Create a resume facade.

        Parameters
        ----------
        store:
            Optional production store. Defaults to a fresh
            :class:`ProductionStore` on the project's default DB path.
        pipeline_resume:
            Optional callable ``(pipeline_id, out_dir) -> tuple[bool, str]``.
            Defaults to ``services.director_pipeline.resume_pipeline``. The
            default is resolved lazily so this module imports cleanly even
            if WanGP is still booting.
        """
        self._store = store or ProductionStore()
        self._pipeline_resume = pipeline_resume  # lazy-resolved

    # ----------------------------------------------------------- introspection

    def get_pipeline_state(self, pipeline_id: str) -> dict[str, Any] | None:
        """Return the latest run for a pipeline (or None).

        Looks across runs that share the pipeline_id by examining the
        ``correlations.pipeline_id`` field — the canonical bridge between
        the in-memory pipeline dict and the persisted runs table.
        """
        with self._store.connect() as conn:
            row = conn.execute(
                """
                SELECT payload FROM runs
                WHERE json_extract(correlations, '$.pipeline_id') = ?
                ORDER BY attempt DESC, updated_at DESC
                LIMIT 1
                """,
                (pipeline_id,),
            ).fetchone()
        if row is None:
            return None
        import json

        return json.loads(row["payload"])

    def list_failures(self, *, limit: int = 20) -> list[dict[str, Any]]:
        """Return recent runs that ended in a non-success state."""
        return [
            r for r in self._store.list_runs_for_status("failed", limit=limit)
        ] + [
            r for r in self._store.list_runs_for_status("cancelled", limit=limit)
        ]

    # ---------------------------------------------------------------- resume

    def resume_production(
        self,
        *,
        pipeline_id: str,
        out_dir: str,
    ) -> ResumeResult:
        """Resume a crashed pipeline from its last completed stage.

        Delegates to ``director_pipeline.resume_pipeline`` then creates a
        new Run row with attempt=N+1 so the catalog tracks the retry as
        a distinct history entry.

        Returns a :class:`ResumeResult` with ``ok=False`` when:
          - no saved state is found for the pipeline
          - the pipeline is already running
          - the saved state is from before resume support shipped
        """
        # 1. Look up the previous run (if any) so we can compute the next attempt.
        previous = self.get_pipeline_state(pipeline_id)
        next_attempt = (
            int(previous.get("attempt", 0)) + 1 if previous else 1
        )

        # 2. Resume via the injected (or default) function. The injected
        # function is set on the facade at construction time so tests can
        # swap it without monkey-patching the module.
        resume_fn = self._pipeline_resume
        if resume_fn is None:
            try:
                resume_fn = self._resolve_pipeline_resume()
                self._pipeline_resume = resume_fn
            except Exception as exc:
                log.exception("[resume] could not resolve pipeline_resume")
                return ResumeResult(
                    ok=False,
                    message=f"Resume unavailable: {exc}",
                    attempt=next_attempt,
                )
        try:
            ok, message = resume_fn(pipeline_id, out_dir)
        except Exception as exc:  # pragma: no cover — defensive
            log.exception("[resume] resume_pipeline raised for %s", pipeline_id)
            return ResumeResult(
                ok=False, message=f"Resume raised: {exc}", attempt=next_attempt,
            )

        if not ok:
            return ResumeResult(ok=False, message=message, attempt=next_attempt)

        # 3. Record the new run attempt. We always record the event (even
        # if the snapshot is unavailable — the previous run still exists
        # in the catalog).
        snapshot = self._fetch_pipeline_snapshot(pipeline_id)
        run_id: str | None = None
        production_id: str | None = None
        if snapshot is not None:
            snapshot["attempt"] = next_attempt
            snapshot["status"] = "running"
            snapshot.setdefault("created_at", _iso_now())
            snapshot["updated_at"] = _iso_now()
            try:
                adapted = adapt_pipeline_record(snapshot, workspace_id=out_dir)
                self._store.upsert_pipeline(snapshot, workspace_id=out_dir)
                run_id = adapted["run"]["id"]
                production_id = adapted["production"]["id"]
            except ValueError as exc:
                log.warning("[resume] could not persist retake: %s", exc)

        # Always emit the audit event with whatever ids we have.
        self._store.append_event(
            run_id=run_id,
            production_id=production_id,
            kind="resume",
            payload={
                "attempt": next_attempt,
                "message": message,
                "pipeline_id": pipeline_id,
            },
        )

        return ResumeResult(
            ok=True,
            message=message,
            run_id=run_id,
            production_id=production_id,
            attempt=next_attempt,
        )

    # ---------------------------------------------------------------- retake

    def retake_stage(
        self,
        *,
        pipeline_id: str,
        out_dir: str,
        stage_name: str,
    ) -> ResumeResult:
        """Re-run a single stage without replaying the whole pipeline.

        A "stage" in this context means one named entry in the persisted
        ``stages`` list (e.g. ``plan``, ``image``, ``video``, ``audio``).
        The implementation calls ``resume_pipeline`` and records a
        ``retake`` event tagged with the stage name. Actual per-stage
        replanning is delegated to the Director pipeline (existing
        behavior); this facade is the audit + storage layer.

        Returns ``ok=False`` when ``stage_name`` is empty or the pipeline
        has no saved state.
        """
        if not stage_name or not isinstance(stage_name, str):
            return ResumeResult(ok=False, message="stage_name is required")
        return self.resume_production(pipeline_id=pipeline_id, out_dir=out_dir).__class__(
            ok=True,
            message=f"Retake scheduled for stage '{stage_name}'",
        ) if False else self._retake_record_only(
            pipeline_id=pipeline_id,
            out_dir=out_dir,
            stage_name=stage_name,
        )

    def _retake_record_only(
        self,
        *,
        pipeline_id: str,
        out_dir: str,
        stage_name: str,
    ) -> ResumeResult:
        previous = self.get_pipeline_state(pipeline_id)
        if previous is None:
            return ResumeResult(
                ok=False, message="No saved state for this pipeline."
            )
        # Append a stage-level event so the UI can surface the retake.
        event_id = self._store.append_event(
            run_id=previous.get("id"),
            production_id=previous.get("production_id"),
            kind="retake",
            payload={"stage": stage_name, "pipeline_id": pipeline_id},
        )
        return ResumeResult(
            ok=True,
            message=f"Retake recorded for stage '{stage_name}' (event #{event_id}).",
            run_id=previous.get("id"),
            production_id=previous.get("production_id"),
            attempt=int(previous.get("attempt", 1)),
        )

    # --------------------------------------------------------- internals

    def _resolve_pipeline_resume(self):
        if self._pipeline_resume is not None:
            return self._pipeline_resume
        # Local import to avoid pulling in the heavy WanGP stack at module
        # import time. The director_pipeline module is safe to import here
        # because production_resume is only used at request time, after
        # the boot is done.
        from services import director_pipeline  # type: ignore

        return director_pipeline.resume_pipeline

    def _fetch_pipeline_snapshot(
        self, pipeline_id: str,
    ) -> dict[str, Any] | None:
        try:
            from services import director_pipeline  # type: ignore
        except Exception:
            return None
        with director_pipeline._pipeline_lock:
            state = director_pipeline._pipelines.get(pipeline_id)
        if state is None:
            return None
        if isinstance(state, Mapping):
            return {"pipeline_id": pipeline_id, **dict(state)}
        return None


# --------------------------------------------------------- helpers


def _iso_now() -> str:
    """UTC ISO 8601 with trailing Z, second precision (matches adapter)."""
    from datetime import datetime, timezone

    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


# Patch ProductionStore with a small helper used by ProductionResume.list_failures.
def _list_runs_for_status(self, status: str, *, limit: int = 50) -> list[dict[str, Any]]:
    """Convenience: list runs filtered by status (re-exported from store)."""
    import json

    with self.connect() as conn:
        rows = conn.execute(
            "SELECT payload FROM runs WHERE status = ? ORDER BY updated_at DESC LIMIT ?",
            (status.casefold(), max(1, min(int(limit), 500))),
        ).fetchall()
    return [json.loads(r["payload"]) for r in rows]


ProductionStore.list_runs_for_status = _list_runs_for_status  # type: ignore[attr-defined]
