"""SQLite-backed Production + Run store (Phase B of the HocusPocus migration).

Persists the read-models produced by :mod:`services.production_adapter` so
that a Director pipeline interrupted by ``kill -9``, browser close, or
OOM can be inspected and retried after restart.

Schema (added as migration v2 to ``services.app_state_db``):

  productions (
      id           TEXT PRIMARY KEY,
      schema       TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      kind         TEXT NOT NULL,
      title        TEXT NOT NULL,
      project      TEXT,                -- JSON-encoded {kind, id}
      workspace_ids TEXT NOT NULL,      -- JSON-encoded list
      created_at   TEXT,
      updated_at   TEXT,
      plan         TEXT NOT NULL,       -- JSON-encoded {clip_count, generation_mode}
      payload      TEXT NOT NULL        -- JSON-encoded full record
  )

  runs (
      id             TEXT PRIMARY KEY,
      production_id  TEXT NOT NULL,
      attempt        INTEGER NOT NULL DEFAULT 1,
      status         TEXT NOT NULL,
      phase          TEXT,
      workspace_id   TEXT NOT NULL,
      created_at     TEXT,
      started_at     TEXT,
      updated_at     TEXT,
      completed_at   TEXT,
      correlations   TEXT,                -- JSON-encoded {pipeline_id, task_id, job_id}
      output_count   INTEGER NOT NULL DEFAULT 0,
      error          TEXT,
      stages         TEXT NOT NULL DEFAULT '[]',  -- JSON-encoded list
      payload        TEXT NOT NULL,
      FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE
  )

  production_events (append-only audit log; written on every stage transition)

Index on ``runs(production_id)`` for fast ``list_runs(production_id)`` and
``index on runs(status, updated_at)`` for the Productions tab filter.

Threading: same pattern as :class:`services.app_state_db.AppStateDB` — one
short-lived connection per call, ``BEGIN IMMEDIATE`` for writes.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from collections.abc import Iterable, Mapping, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import sqlite3

from .production_adapter import (
    PRODUCTION_SCHEMA,
    RUN_SCHEMA,
    SCHEMA_VERSION,
    adapt_pipeline_record,
    build_production_run_catalog,
)


log = logging.getLogger("cue_studio.production_store")


# Re-declared here so callers don't need to import the adapter just to read
# the schema constants. Keep in sync with production_adapter.__all__.
__all__ = [
    "ProductionStore",
    "PRODUCTION_SCHEMA",
    "RUN_SCHEMA",
    "SCHEMA_VERSION",
    "adapt_pipeline_record",
    "build_production_run_catalog",
]


# --------------------------------------------------------------- schema DDL


# v2 migration applied lazily by AppStateDB.bootstrap_productions() — the
# production_store is opt-in so existing installs that never call into it
# stay untouched.

_PRODUCTIONS_DDL = """
CREATE TABLE IF NOT EXISTS productions (
    id TEXT PRIMARY KEY,
    schema TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    project TEXT,
    workspace_ids TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    plan TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_productions_updated ON productions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_productions_kind ON productions(kind);

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    production_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    phase TEXT,
    workspace_id TEXT NOT NULL,
    created_at TEXT,
    started_at TEXT,
    updated_at TEXT,
    completed_at TEXT,
    correlations TEXT,
    output_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    stages TEXT NOT NULL DEFAULT '[]',
    payload TEXT NOT NULL,
    FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_runs_production ON runs(production_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS production_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_id TEXT,
    run_id TEXT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pe_run ON production_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pe_kind ON production_events(kind, created_at);
"""


def _default_db_path() -> Path:
    """Resolve the same path the rest of the app uses (services.app_state_db)."""
    repo_root = Path(__file__).resolve().parents[1]
    return repo_root / ".cache" / "app_state.sqlite3"


# ------------------------------------------------------------------- store


class ProductionStore:
    """Thread-safe Production + Run + event store.

    The class opens a short-lived SQLite connection per call. Writes wrap
    their statements in ``BEGIN IMMEDIATE`` so concurrent writers cannot
    interleave a partial update.
    """

    def __init__(self, db_path: Path | str | None = None) -> None:
        self._db_path = Path(db_path) if db_path else _default_db_path()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._ensure_schema()

    # --------------------------------------------------------------- schema

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self._db_path), timeout=10.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
        finally:
            conn.close()

    def _ensure_schema(self) -> None:
        with self._lock, self.connect() as conn:
            conn.executescript(_PRODUCTIONS_DDL)
            conn.commit()

    # --------------------------------------------------------------- writes

    def upsert_pipeline(self, snapshot: Mapping[str, Any], workspace_id: str = "default") -> dict[str, Any]:
        """Adapt a pipeline snapshot and persist both the production and the run.

        Returns the adapted ``{"production": ..., "run": ...}`` so the caller
        can surface the canonical ids to the UI without a second read.
        """
        adapted = adapt_pipeline_record(snapshot, workspace_id)
        production = adapted["production"]
        run = adapted["run"]
        now = time.time()
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute(
                    """
                    INSERT INTO productions (
                        id, schema, schema_version, kind, title, project,
                        workspace_ids, created_at, updated_at, plan, payload
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title=excluded.title,
                        project=excluded.project,
                        workspace_ids=excluded.workspace_ids,
                        updated_at=excluded.updated_at,
                        plan=excluded.plan,
                        payload=excluded.payload
                    """,
                    (
                        production["id"],
                        production["schema"],
                        production["schema_version"],
                        production["kind"],
                        production["title"],
                        json.dumps(production["project"]) if production["project"] else None,
                        json.dumps(production["workspace_ids"]),
                        production["created_at"],
                        production["updated_at"],
                        json.dumps(production["plan"]),
                        json.dumps(production, ensure_ascii=False, default=str),
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO runs (
                        id, production_id, attempt, status, phase, workspace_id,
                        created_at, started_at, updated_at, completed_at,
                        correlations, output_count, error, stages, payload
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        attempt=excluded.attempt,
                        status=excluded.status,
                        phase=excluded.phase,
                        updated_at=excluded.updated_at,
                        completed_at=excluded.completed_at,
                        output_count=excluded.output_count,
                        error=excluded.error,
                        stages=excluded.stages,
                        payload=excluded.payload
                    """,
                    (
                        run["id"],
                        run["production_id"],
                        run["attempt"],
                        run["status"],
                        run["phase"],
                        run["workspace_id"],
                        run["created_at"],
                        run["started_at"],
                        run["updated_at"],
                        run["completed_at"],
                        json.dumps(run["correlations"]),
                        run["output_count"],
                        run["error"],
                        json.dumps(run["stages"]),
                        json.dumps(run, ensure_ascii=False, default=str),
                    ),
                )
                conn.execute(
                    "INSERT INTO production_events (production_id, run_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                    (
                        production["id"],
                        run["id"],
                        "upsert",
                        json.dumps({"status": run["status"], "phase": run["phase"]}),
                        now,
                    ),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return adapted

    def append_event(
        self,
        *,
        production_id: str | None = None,
        run_id: str | None = None,
        kind: str,
        payload: Mapping[str, Any] | None = None,
    ) -> int:
        """Append an audit event. Returns the new row id."""
        body = json.dumps(dict(payload or {}), ensure_ascii=False, default=str)
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = conn.execute(
                    "INSERT INTO production_events (production_id, run_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                    (production_id, run_id, kind, body, time.time()),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return int(cursor.lastrowid)

    def delete_production(self, production_id: str) -> bool:
        """Remove a production and all its runs (cascade via FK)."""
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = conn.execute(
                    "DELETE FROM productions WHERE id = ?", (production_id,)
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return bool(cursor.rowcount)

    # ---------------------------------------------------------------- reads

    def list_productions(
        self,
        *,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """List productions, optionally filtered by latest-run status."""
        limit = max(1, min(int(limit), 500))
        if status:
            sql = """
                SELECT p.payload
                FROM productions p
                JOIN runs r ON r.production_id = p.id
                WHERE r.id = (
                    SELECT r2.id FROM runs r2
                    WHERE r2.production_id = p.id
                    ORDER BY r2.attempt DESC, r2.updated_at DESC
                    LIMIT 1
                ) AND r.status = ?
                ORDER BY p.updated_at DESC
                LIMIT ?
            """
            params: tuple[Any, ...] = (status.casefold(), limit)
        else:
            sql = "SELECT payload FROM productions ORDER BY updated_at DESC LIMIT ?"
            params = (limit,)

        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [json.loads(r["payload"]) for r in rows]

    def get_production(self, production_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT payload FROM productions WHERE id = ?", (production_id,)
            ).fetchone()
        if row is None:
            return None
        return json.loads(row["payload"])

    def list_runs(self, production_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT payload FROM runs WHERE production_id = ? ORDER BY attempt DESC",
                (production_id,),
            ).fetchall()
        return [json.loads(r["payload"]) for r in rows]

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT payload FROM runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            return None
        return json.loads(row["payload"])

    def list_events(
        self,
        *,
        run_id: str | None = None,
        production_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 1000))
        clauses: list[str] = []
        params: list[Any] = []
        if run_id:
            clauses.append("run_id = ?")
            params.append(run_id)
        if production_id:
            clauses.append("production_id = ?")
            params.append(production_id)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        params.extend([limit])
        sql = (
            "SELECT id, production_id, run_id, kind, payload, created_at "
            f"FROM production_events{where} ORDER BY created_at DESC LIMIT ?"
        )
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [
            {
                "id": int(r["id"]),
                "production_id": r["production_id"],
                "run_id": r["run_id"],
                "kind": r["kind"],
                "payload": json.loads(r["payload"]) if r["payload"] else {},
                "created_at": float(r["created_at"]),
            }
            for r in rows
        ]

    # --------------------------------------------------------- convenience

    def sync_from_pipelines(
        self,
        pipelines: Iterable[Mapping[str, Any]],
        workspace_id: str = "default",
    ) -> int:
        """Persist every pipeline snapshot. Returns the count adapted."""
        count = 0
        for snapshot in pipelines:
            try:
                self.upsert_pipeline(snapshot, workspace_id)
            except ValueError as exc:
                log.warning("[production-store] skipping malformed pipeline: %s", exc)
                continue
            count += 1
        return count

    def catalog(self, workspace_id: str = "default") -> dict[str, Any]:
        """Return the full (productions, runs) catalog from the on-disk DB.

        Equivalent to ``build_production_run_catalog(...)`` but reads from
        the DB rather than from the in-memory pipeline snapshot dict.
        """
        with self.connect() as conn:
            prod_rows = conn.execute("SELECT payload FROM productions").fetchall()
            run_rows = conn.execute("SELECT payload FROM runs").fetchall()
        productions = [json.loads(r["payload"]) for r in prod_rows]
        runs = [json.loads(r["payload"]) for r in run_rows]
        return {
            "productions": sorted(
                productions,
                key=lambda item: (item.get("updated_at") or "", item["id"]),
                reverse=True,
            ),
            "runs": sorted(
                runs,
                key=lambda item: (item.get("updated_at") or "", item["id"]),
                reverse=True,
            ),
            "workspace_id": workspace_id,
        }
