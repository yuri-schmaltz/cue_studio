# Persistence matrix (A18)

Every durable entity in Cue Studio, its source of truth, schema,
backup strategy, and migration path. Spec:
`_reversa_forward/plano-2026-10-04/24-feature-a18-persistence.md`.

> **Deviation:** the spec asks for `docs/persistence-matrix.md`; the
> repository edit policy for this cycle only allows `app/**`, so the
> document lives in `app/docs/`.

## Matrix

| Entity | Source of truth | Schema | Backup | Migration |
|---|---|---|---|---|
| App settings (kv) | SQLite `app_state.sqlite3` → `kv` | `app/migrations/0001_init.sql` | `scripts/backup.py` | `migrations/0001_init.sql` / `app_state_db._MIGRATIONS[1]` |
| Workspaces (registry) | SQLite → `workspaces` | `app/migrations/0001_init.sql` | `scripts/backup.py` | `0001_init.sql` |
| Workspace setup (project card) | Filesystem `setup.json` per workspace | `services/workspace_setup.py` (Pydantic-free dict contract) | copy of projects root | one-time JSON defaults (`DEFAULT_PROJECT_SETUP`) |
| Director queue (durable) | SQLite → `director_queue` | `app/migrations/0001_init.sql` | `scripts/backup.py` | `0001_init.sql` |
| Director queue (runtime) | Filesystem `_director_queue.json` + `_director_queue_assets/` per projects root | `services/director_pipeline.py` | copy of projects root | n/a (derived snapshot) |
| Productions / Runs | SQLite → `productions`, `runs` | `app/migrations/0002_add_productions.sql` | `scripts/backup.py` | `0002_add_productions.sql` / lazy `ProductionStore._ensure_schema` |
| Production events (audit) | SQLite → `production_events` | `app/migrations/0002_add_productions.sql` | `scripts/backup.py` | `0002_add_productions.sql` |
| History (append-only) | SQLite → `history` | `app/migrations/0001_init.sql` | `scripts/backup.py` | `0001_init.sql` |
| System config | Filesystem `wgp_config.json` | `wgp.server_config` dict | file copy | n/a |
| Media (inputs/outputs) | Filesystem `projects root/` | folder conventions | file copy (out of scope for SQLite backup) | n/a |
| Model catalog cache | SQLite `model_catalog.sqlite3` (derived, rebuildable) | `services/model_catalog_cache.py` | none needed | n/a |

## Locations and overrides

The app-state database resolves through
`services.app_state_db.get_default_db_path()`:

1. `APP_SQLITE_PATH` env var — explicit override (used by the test suite,
   see A06 / `tests/conftest.py`);
2. `APP_CACHE_DIR` env var + `/app_state.sqlite3`;
3. fallback `app/.cache/app_state.sqlite3`.

`services.production_store`, `services.model_catalog_cache`, and every
consumer share the same resolution.

## Versioned migrations

`app/migrations/runner.py` is the idempotent runner (contract:
`_reversa_forward/.../contracts/migration_runner.py`):

* `discover_migrations(dir)` — ordered `NNNN_*.sql` files;
* `migrate(conn, dir, dry_run=False)` — applies pending versions,
  records them in a `schema_version` table; running twice is a no-op;
* `status(conn, dir)` — `{"applied": [...], "pending": [...]}`.

Every SQL file uses `IF NOT EXISTS`, so overlaying the file-based
migrations on a database already migrated by `app_state_db`'s inline
tracker is safe. One known delta: databases created before A19 lack
`runs.interrupted_at`; `ProductionStore._ensure_schema()` adds it via a
guarded `ALTER TABLE` at runtime (SQLite has no `ADD COLUMN IF NOT
EXISTS`).

## Backup / restore

`scripts/backup.py` uses the SQLite online backup API (consistent under
WAL); `scripts/restore.py` validates the backup before overwriting,
removes stale `-wal`/`-shm` sidecars, and keeps the previous database as
`<db>.pre-restore`. Both scripts honor the env overrides above, which is
how the acceptance tests exercise them against isolated copies
(`tests/test_migration_runner.py`).

## Scenarios covered by tests

* migration on an empty database (0001 → 0002);
* migration is idempotent (second run applies nothing);
* `status()` reports applied vs pending;
* `dry_run` does not touch the database;
* files without a `NNNN_` prefix are ignored;
* backup → mutate → restore preserves state on isolated copies.
