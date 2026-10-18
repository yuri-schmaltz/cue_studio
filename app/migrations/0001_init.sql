-- 0001_init.sql — initial app-state schema (A18).
--
-- Mirrors the inline v1 migration of services/app_state_db.py so a fresh
-- database built by the file-based runner matches one built at boot.
-- Every statement is idempotent: overlaying this file on an existing
-- database (already migrated by app_state_db) is a safe no-op.
--
-- The runner tracks versions in its own `schema_version` table; the
-- `migrations` table below belongs to app_state_db's internal tracker
-- and is created here so both tools see the same shape.

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
