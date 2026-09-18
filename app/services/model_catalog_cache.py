"""SQLite-backed cache for the static-ish catalogue endpoints.

The catalogue endpoints (``GET /api/v1/models``,
``GET /api/v1/loras/installed``, ``GET /api/v1/llm/models``) return
data that only changes when the user explicitly installs or uninstalls
a model or LoRA, or swaps the LLM provider. Polling those endpoints
every 2-15 seconds from the UI hits the database and the filesystem
each time for no benefit.

This module adds a tiny SQLite cache layer in front of those endpoints
so the cached snapshot is served immediately and the expensive recompute
only runs when the cache expires or is invalidated.

Cache layout
------------
A single SQLite file at ``<app>/.cache/model_catalog.sqlite3`` holds one
row per endpoint. ``value`` is the JSON payload, ``fetched_at`` is the
unix timestamp of the last refresh, ``ttl_seconds`` is the maximum age
before a refresh is forced.

Invalidation
------------
``POST /api/v1/models/reload`` and the matching LoRA endpoints call
``invalidate_cache()`` so a refresh always sees the post-install state.
A future enhancement would be a content-hash comparison so a model
swap invalidates downstream consumers automatically.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping


log = logging.getLogger("cue_studio.model_cache")


_DEFAULT_TTL = {
    "models": 60 * 5,         # 5 minutes — catalogue rarely changes
    "loras_installed": 60 * 5, # 5 minutes
    "llm_models": 60 * 15,    # 15 minutes — user only swaps providers occasionally
}


def _default_cache_path() -> Path:
    repo_root = Path(__file__).resolve().parents[1]
    return repo_root / ".cache" / "model_catalog.sqlite3"


class ModelCatalogCache:
    """Tiny SQLite cache for JSON catalogue snapshots.

    Thread-safe by design: every public method takes the same internal
    ``RLock`` so concurrent fetches from different FastAPI workers (or
    different threads of the Uvicorn process) cannot race the SQLite
    write transaction.
    """

    def __init__(self, db_path: Path | None = None, ttl_map: Mapping[str, int] | None = None) -> None:
        self._db_path = Path(db_path) if db_path else _default_cache_path()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ttl: dict[str, int] = dict(_DEFAULT_TTL)
        if ttl_map:
            self._ttl.update(ttl_map)
        self._lock = threading.RLock()
        self._ensure_schema()

    # ------------------------------------------------------------------
    # Schema management
    # ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), timeout=10.0, isolation_level=None)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS catalog_cache (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    fetched_at REAL NOT NULL,
                    ttl_seconds INTEGER NOT NULL
                )
                """
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_fresh(self, key: str, fetcher: Callable[[], Any], *, force: bool = False) -> tuple[Any, bool]:
        """Return ``(payload, cache_hit)``.

        The cache is consulted first; on miss, expiry or forced refresh
        ``fetcher`` is called and its result is stored. ``cache_hit`` is
        True when the value came from SQLite without invoking
        ``fetcher``.
        """

        ttl = self._ttl.get(key, 60)
        now = time.time()

        with self._lock:
            if not force:
                row = self._read(key)
                if row is not None:
                    value, fetched_at = row
                    if (now - fetched_at) <= ttl:
                        try:
                            return json.loads(value), True
                        except (TypeError, ValueError):
                            # Corrupt cache row — drop and fall through to refresh.
                            self._delete(key)

            try:
                payload = fetcher()
            except Exception:
                # Fetcher failure must never crash the request. If we
                # have a stale value, return it; otherwise re-raise so
                # the caller sees the real failure mode.
                row = self._read(key)
                if row is not None:
                    value, _ = row
                    try:
                        return json.loads(value), True
                    except (TypeError, ValueError):
                        pass
                raise

            self._write(key, payload, ttl, now)
            return payload, False

    def invalidate(self, key: str | None = None) -> int:
        """Remove a single key (or all keys when ``key`` is None)."""

        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                if key is None:
                    cursor = conn.execute("DELETE FROM catalog_cache")
                    count = cursor.rowcount
                else:
                    cursor = conn.execute("DELETE FROM catalog_cache WHERE key = ?", (key,))
                    count = cursor.rowcount
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return count

    def stats(self) -> dict[str, Any]:
        """Inspect cache contents (rows + freshness)."""

        now = time.time()
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT key, fetched_at, ttl_seconds, length(value) FROM catalog_cache"
            ).fetchall()

        return {
            "path": str(self._db_path),
            "entries": [
                {
                    "key": r[0],
                    "age_seconds": now - r[1],
                    "ttl_seconds": r[2],
                    "size_bytes": r[3],
                    "expired": (now - r[1]) > r[2],
                }
                for r in rows
            ],
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _read(self, key: str) -> tuple[str, float] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value, fetched_at FROM catalog_cache WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            return None
        return (row[0], float(row[1]))

    def _write(self, key: str, payload: Any, ttl: int, fetched_at: float) -> None:
        text = json.dumps(payload, ensure_ascii=False, default=str)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO catalog_cache (key, value, fetched_at, ttl_seconds)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value=excluded.value,
                    fetched_at=excluded.fetched_at,
                    ttl_seconds=excluded.ttl_seconds
                """,
                (key, text, fetched_at, ttl),
            )

    def _delete(self, key: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM catalog_cache WHERE key = ?", (key,))


_singleton: ModelCatalogCache | None = None
_singleton_lock = threading.Lock()


def get_cache() -> ModelCatalogCache:
    """Process-wide singleton accessor.

    Initialising the SQLite database is cheap (one ``CREATE TABLE IF NOT
    EXISTS``) but going through a lock keeps the path safe under
    FastAPI's threaded worker model.
    """

    global _singleton
    with _singleton_lock:
        if _singleton is None:
            _singleton = ModelCatalogCache()
        return _singleton


def reset_cache_singleton() -> None:
    """Test helper — drop the cached singleton so the next ``get_cache``
    call rebuilds it from a fresh path."""

    global _singleton
    with _singleton_lock:
        _singleton = None


__all__ = ["ModelCatalogCache", "get_cache", "reset_cache_singleton"]
