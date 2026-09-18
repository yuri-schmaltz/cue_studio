"""Unified SQLite-backed application state.

Why a unified SQLite store
--------------------------
Historically Cue Studio persisted every domain object to its own JSON
file: ``wgp_config.json`` for system settings, ``web_push.json`` for
notifications, ``setup.json`` per workspace, ``_director_queue.json`` for
the pipeline queue, ad-hoc recipes files, model presets, and so on.

JSON files are fine for human-readable config but they hit a wall when
you start asking cross-cutting questions like:

* "Which projects have a setup that references this removed model?"
* "How many Director productions ran last week?"
* "When was this preference last toggled?"

This module introduces a single SQLite database (WAL, normal sync)
that stores the migration log, key/value settings, workspaces,
director queue, history and migration records in one place. Existing
JSON files keep working — read paths still consult them as a fallback
and seeds populate the new tables on first boot. A future step
(``migrate_legacy_json_into_db``) will sweep the JSON files into the
SQLite store one workspace at a time, gated by a per-key migration
record so partial failures never corrupt state.

Schema design
-------------
* ``migrations`` — ordered list of applied schema versions.
* ``kv`` — generic key/value with a JSON-encoded payload and a version
  number, so a future schema change can transparently upgrade an old
  blob without breaking callers.
* ``workspaces`` — directory path, name, pinned flag, last touched.
* ``director_queue`` — JSON payload + status + created/updated.
* ``history`` — append-only NDJSON-equivalent for audit / debug.

Threading
---------
SQLite connections are per-thread by convention. We hand out a new
connection on each ``connect()`` call. Writes are serialised through
``BEGIN IMMEDIATE`` transactions to keep the database consistent under
the multi-threaded FastAPI/uvicorn worker model.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, Sequence


log = logging.getLogger("cue_studio.app_state_db")


SCHEMA_VERSION = 1


def _default_db_path() -> Path:
    repo_root = Path(__file__).resolve().parents[1]
    return repo_root / ".cache" / "app_state.sqlite3"


# Migration scripts run sequentially on every boot. ``up`` SQL is applied
# inside a transaction; if any statement fails the whole migration is
# rolled back and the boot refuses to start the API.
_MIGRATIONS: Sequence[tuple[int, str]] = (
    (1, """
    CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        last_touched REAL
    );

    CREATE TABLE IF NOT EXISTS director_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pipeline_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dq_pipeline ON director_queue(pipeline_id);

    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_kind ON history(kind, created_at);

    CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        applied_at REAL NOT NULL
    );
    """),
)


class AppStateDB:
    """SQLite-backed application state.

    The class is safe to share across threads. Each public method opens
    a short-lived SQLite connection in WAL mode; writes wrap their
    statements in a transaction.
    """

    def __init__(self, db_path: Path | str | None = None) -> None:
        self._db_path = Path(db_path) if db_path else _default_db_path()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._ensure_schema()

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Open a SQLite connection with the project's preferred pragmas.

        ``isolation_level`` stays at the default (deferred transactions)
        so the explicit ``BEGIN IMMEDIATE`` / ``COMMIT`` / ``ROLLBACK``
        pairs below actually open transactions. ``check_same_thread``
        is False because the FastAPI worker pool can use multiple OS
        threads concurrently.
        """

        conn = sqlite3.connect(
            str(self._db_path),
            timeout=10.0,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Schema / migrations
    # ------------------------------------------------------------------

    def _ensure_schema(self) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                # The migrations table itself must exist before we can
                # track what's been applied; create it eagerly.
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS migrations (
                        version INTEGER PRIMARY KEY,
                        applied_at REAL NOT NULL
                    )
                    """
                )
                applied = {
                    row[0]
                    for row in conn.execute("SELECT version FROM migrations").fetchall()
                }
                for version, ddl in _MIGRATIONS:
                    if version in applied:
                        continue
                    log.info("[app-state-db] applying migration %d", version)
                    conn.executescript(ddl)
                    conn.execute(
                        "INSERT OR IGNORE INTO migrations (version, applied_at) VALUES (?, ?)",
                        (version, time.time()),
                    )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def schema_version(self) -> int:
        with self.connect() as conn:
            row = conn.execute("SELECT MAX(version) FROM migrations").fetchone()
        return int(row[0] or 0)

    # ------------------------------------------------------------------
    # Generic KV
    # ------------------------------------------------------------------

    def kv_set(self, key: str, value: Any, *, version: int = 1) -> None:
        text = json.dumps(value, ensure_ascii=False, default=str)
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute(
                    """
                    INSERT INTO kv (key, value, version, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value=excluded.value,
                        version=excluded.version,
                        updated_at=excluded.updated_at
                    """,
                    (key, text, version, time.time()),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def kv_get(self, key: str, default: Any = None) -> Any:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT value, version FROM kv WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            return default
        try:
            return json.loads(row["value"])
        except (TypeError, ValueError):
            return default

    def kv_delete(self, key: str) -> bool:
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = conn.execute("DELETE FROM kv WHERE key = ?", (key,))
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return bool(cursor.rowcount)

    # ------------------------------------------------------------------
    # Workspaces
    # ------------------------------------------------------------------

    def upsert_workspace(self, name: str, path: str, *, pinned: bool = False) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute(
                    """
                    INSERT INTO workspaces (name, path, pinned, last_touched)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET
                        path=excluded.path,
                        pinned=excluded.pinned,
                        last_touched=excluded.last_touched
                    """,
                    (name, path, 1 if pinned else 0, time.time()),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def list_workspaces(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT name, path, pinned, last_touched FROM workspaces ORDER BY name"
            ).fetchall()
        return [
            {
                "name": r["name"],
                "path": r["path"],
                "pinned": bool(r["pinned"]),
                "last_touched": r["last_touched"],
            }
            for r in rows
        ]

    def delete_workspace(self, name: str) -> bool:
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = conn.execute("DELETE FROM workspaces WHERE name = ?", (name,))
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return bool(cursor.rowcount)

    # ------------------------------------------------------------------
    # Director queue
    # ------------------------------------------------------------------

    def upsert_director_entry(self, *, pipeline_id: str, status: str, payload: Mapping[str, Any]) -> None:
        text = json.dumps(dict(payload), ensure_ascii=False, default=str)
        now = time.time()
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute(
                    """
                    INSERT INTO director_queue (pipeline_id, status, payload, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(pipeline_id) DO UPDATE SET
                        status=excluded.status,
                        payload=excluded.payload,
                        updated_at=excluded.updated_at
                    """,
                    (pipeline_id, status, text, now, now),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def list_director_queue(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT pipeline_id, status, payload, created_at, updated_at FROM director_queue ORDER BY id"
            ).fetchall()
        result = []
        for r in rows:
            try:
                payload = json.loads(r["payload"])
            except (TypeError, ValueError):
                payload = {}
            result.append(
                {
                    "pipeline_id": r["pipeline_id"],
                    "status": r["status"],
                    "payload": payload,
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                }
            )
        return result

    def remove_director_entry(self, pipeline_id: str) -> bool:
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = conn.execute(
                    "DELETE FROM director_queue WHERE pipeline_id = ?", (pipeline_id,)
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return bool(cursor.rowcount)

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def append_history(self, kind: str, payload: Mapping[str, Any]) -> int:
        text = json.dumps(dict(payload), ensure_ascii=False, default=str)
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = conn.execute(
                    "INSERT INTO history (kind, payload, created_at) VALUES (?, ?, ?)",
                    (kind, text, time.time()),
                )
                last_id = int(cursor.lastrowid)
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return last_id

    def list_history(self, kind: str | None = None, *, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as conn:
            if kind:
                rows = conn.execute(
                    "SELECT id, kind, payload, created_at FROM history WHERE kind = ? ORDER BY id DESC LIMIT ?",
                    (kind, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, kind, payload, created_at FROM history ORDER BY id DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        result = []
        for r in rows:
            try:
                payload = json.loads(r["payload"])
            except (TypeError, ValueError):
                payload = {}
            result.append(
                {
                    "id": r["id"],
                    "kind": r["kind"],
                    "payload": payload,
                    "created_at": r["created_at"],
                }
            )
        return result

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        with self.connect() as conn:
            kv_count = conn.execute("SELECT COUNT(*) FROM kv").fetchone()[0]
            ws_count = conn.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0]
            dq_count = conn.execute("SELECT COUNT(*) FROM director_queue").fetchone()[0]
            hist_count = conn.execute("SELECT COUNT(*) FROM history").fetchone()[0]
            schema = conn.execute("SELECT MAX(version) FROM migrations").fetchone()[0]
        return {
            "path": str(self._db_path),
            "schema_version": schema or 0,
            "kv_count": kv_count,
            "workspaces_count": ws_count,
            "director_queue_count": dq_count,
            "history_count": hist_count,
        }


_singleton: AppStateDB | None = None
_singleton_lock = threading.Lock()


def get_app_state_db() -> AppStateDB:
    """Process-wide singleton accessor."""

    global _singleton
    with _singleton_lock:
        if _singleton is None:
            _singleton = AppStateDB()
        return _singleton


def reset_app_state_db_singleton() -> None:
    """Test helper to drop the cached singleton so a fresh instance is built."""

    global _singleton
    with _singleton_lock:
        _singleton = None


__all__ = [
    "AppStateDB",
    "SCHEMA_VERSION",
    "get_app_state_db",
    "reset_app_state_db_singleton",
]
