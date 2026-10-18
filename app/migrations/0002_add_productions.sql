-- 0002_add_productions.sql — Production + Run catalog (A18/A19).
--
-- Mirrors services/production_store.py._PRODUCTIONS_DDL, including the
-- A19 `runs.interrupted_at` column. Databases created before A19 lack
-- that column; ProductionStore._ensure_schema() adds it via a guarded
-- ALTER at runtime, and re-running this file remains a no-op because of
-- IF NOT EXISTS.

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
    interrupted_at TEXT,
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
