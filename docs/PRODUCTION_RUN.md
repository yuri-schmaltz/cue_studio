# Production Run — durable Director pipeline history (v2.3.0)

> **Status:** v2.3.0 — production-ready. Productions persist across restarts;
> resume and retake are functional; MCP tools expose the catalog.

A **Production** is the durable identity for a creative intent (e.g. "the
music video for song X"). A **Run** is one execution attempt of that
Production. When a pipeline crashes mid-stage, the original Production
stays the same, a new Run is created with `attempt=N+1`, and the failed
stages can be replayed from the last completed checkpoint.

This is Phase B of the [HocusPocus migration plan](MIGRATION_HOCUSPOCUS.md).

---

## Why

Before v2.3.0, the Director pipeline lived only in `_pipelines` — an
in-memory dict that evaporated on `kill -9`, browser close, or OOM. A
crash meant "start over". v2.3.0 persists every pipeline snapshot to
SQLite so:

- **Crashes are recoverable** — `POST /api/v1/productions/{id}/resume`
  replays from the last completed stage.
- **Retries are tracked** — `attempt=2,3,...` keep the history of every
  retry in the same Production.
- **Agents can inspect history** — `GET /api/v1/productions/{id}/events`
  exposes the audit log of upserts, resumes and retakes.

---

## Architecture

```
                ┌─────────────────────┐
                │ director_pipeline   │
                │  _pipelines (RAM)   │
                └─────────┬───────────┘
                          │ upsert_pipeline(snapshot)
                          ▼
                ┌─────────────────────┐
                │ ProductionStore     │  ← SQLite (WAL mode,
                │ (services/production│     foreign_keys=ON,
                │  _store.py)         │     thread-safe per-call
                └─────────┬───────────┘
                          │
                          ▼
                ┌─────────────────────┐
                │ /api/v1/productions │  ← FastAPI router
                │ + MCP tools:        │
                │   productions_list  │
                │   production_get    │
                └─────────────────────┘
```

The orchestrator (`services/production_resume.py`) glues the store with
the existing `director_pipeline.resume_pipeline()` so the audit + retry
semantics live in one place.

---

## HTTP API

### Read endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/productions` | List productions (filter: `?status=`, `?limit=`) |
| `GET` | `/api/v1/productions/{id}` | One production + its runs |
| `GET` | `/api/v1/productions/{id}/runs` | Just the runs |
| `GET` | `/api/v1/productions/{id}/events` | Audit log (upserts, resumes, retakes) |

### Write endpoints

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/productions/{id}/resume` | `{"out_dir": "..."}` | Resume from last completed stage |
| `POST` | `/api/v1/productions/{id}/retake` | `{"stage": "image", "out_dir": "..."}` | Retake one stage |

Both write endpoints return:

```json
{
  "ok": true,
  "message": "Resumed successfully",
  "run_id": "run_legacy_...",
  "production_id": "production_legacy_...",
  "attempt": 2
}
```

---

## MCP tools (added in v2.3.0)

Two read-mostly tools join the v2.2.0 MCP server. The full list is now:

| Tool | Type | Description |
|---|---|---|
| `productions_list` | read | List productions with optional status filter |
| `production_get` | read | Fetch one production + its runs |

Example agent interaction:

```bash
# List failed productions to surface retry candidates
curl -s -X POST http://127.0.0.1:7860/api/v1/mcp \
  -H "Authorization: Bearer $CUE_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {"name": "productions_list", "arguments": {"status": "failed"}}
  }'

# Inspect one production's runs before suggesting a resume
curl -s -X POST http://127.0.0.1:7860/api/v1/mcp \
  -H "Authorization: Bearer $CUE_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {"name": "production_get",
               "arguments": {"production_id": "production_legacy_..."}}
  }'
```

---

## SQLite schema

Tables created lazily on `ProductionStore()` init:

```sql
CREATE TABLE productions (
    id TEXT PRIMARY KEY,                 -- production_legacy_<hex>
    schema TEXT NOT NULL,                -- 'cue_studio.production-record'
    schema_version INTEGER NOT NULL,     -- 1
    kind TEXT NOT NULL,                  -- 'music_video', 'short_film', ...
    title TEXT NOT NULL,
    project TEXT,                        -- JSON: {kind, id} or NULL
    workspace_ids TEXT NOT NULL,         -- JSON array
    created_at TEXT,
    updated_at TEXT,
    plan TEXT NOT NULL,                  -- JSON: {clip_count, generation_mode}
    payload TEXT NOT NULL                -- JSON: full record
);

CREATE TABLE runs (
    id TEXT PRIMARY KEY,                 -- run_legacy_<hex> (keyed on pipeline_id+attempt)
    production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,                -- running | completed | failed | cancelled
    phase TEXT,
    workspace_id TEXT NOT NULL,
    created_at TEXT,
    started_at TEXT,
    updated_at TEXT,
    completed_at TEXT,
    correlations TEXT,                   -- JSON: {pipeline_id, task_id, job_id}
    output_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    stages TEXT NOT NULL DEFAULT '[]',   -- JSON array
    payload TEXT NOT NULL,
    FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE
);

CREATE TABLE production_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_id TEXT,
    run_id TEXT,
    kind TEXT NOT NULL,                  -- 'upsert' | 'resume' | 'retake'
    payload TEXT NOT NULL,
    created_at REAL NOT NULL
);
```

Indexes on `productions(updated_at)`, `runs(production_id)`,
`runs(status, updated_at)`, `production_events(run_id, created_at)`.

---

## Resume vs Retake

| | Resume | Retake |
|---|---|---|
| **Use when** | The whole pipeline is in a bad state (e.g. crash, kill -9) | One specific stage failed but the rest is fine |
| **What it does** | Re-executes from the last completed stage | Re-runs one stage (e.g. just `image`); the rest stays |
| **Side effects** | New Run row (`attempt += 1`), audit event | Audit event tagged with the stage name |
| **Idempotency** | Safe to call repeatedly (existing `_pipeline_lock` guards) | Safe — the underlying stage replays its work |

The actual per-stage replanning logic lives in `director_pipeline`. The
Production Run facade is the audit + storage layer.

---

## Operational notes

- **Default DB path** — `app/.cache/app_state.sqlite3` (same as
  `services.app_state_db`); configurable via `CUE_CONFIG_DIR` env var.
- **WAL mode** — readers don't block writers; safe under multi-thread
  FastAPI.
- **Foreign keys ON** — deleting a Production cascades to its Runs and
  audit events.
- **Crash safety** — every write is wrapped in `BEGIN IMMEDIATE` and
  committed atomically; a `kill -9` mid-write rolls back via WAL.
- **Retention** — not yet implemented (Phase B2.5 in
  [MIGRATION_HOCUSPOCUS.md](MIGRATION_HOCUSPOCUS.md#phase-b2)).

---

## See also

- [docs/MIGRATION_HOCUSPOCUS.md](MIGRATION_HOCUSPOCUS.md) — full plan
- [docs/MCP_SERVER.md](MCP_SERVER.md) — MCP server docs
- `app/services/production_adapter.py` — read-model shaper
- `app/services/production_store.py` — SQLite store
- `app/services/production_resume.py` — facade
- `app/routers/productions.py` — HTTP API
- `tests/test_production_*.py` — 80 tests covering the full stack
