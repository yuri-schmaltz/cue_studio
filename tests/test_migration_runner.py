"""A18 — versioned migrations, persistence matrix contract, backup/restore.

Acceptance criteria from
``_reversa_forward/plano-2026-10-04/24-feature-a18-persistence.md``:
migration runs on an empty database, is idempotent, and backup/restore
preserves state on isolated copies.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from app.migrations import runner  # noqa: E402
from app.services.app_state_db import AppStateDB, get_default_db_path  # noqa: E402
from app.services.production_store import ProductionStore  # noqa: E402


@pytest.fixture
def conn(tmp_path: Path):
    c = sqlite3.connect(tmp_path / "test.sqlite3")
    yield c
    c.close()


@pytest.fixture
def mig_dir(tmp_path: Path) -> Path:
    d = tmp_path / "mig"
    d.mkdir()
    (d / "0001_init.sql").write_text("CREATE TABLE foo (id INTEGER PRIMARY KEY);")
    return d


# ------------------------------------------------------------- runner


def test_migrate_from_empty(conn, mig_dir):
    new = runner.migrate(conn, mig_dir)
    assert new == [1]
    assert {row[0] for row in conn.execute("SELECT v FROM schema_version")} == {1}
    conn.execute("SELECT count(*) FROM foo")


def test_migrate_is_idempotent(conn, mig_dir):
    assert runner.migrate(conn, mig_dir) == [1]
    assert runner.migrate(conn, mig_dir) == []


def test_status_reports_applied_and_pending(conn, mig_dir):
    (mig_dir / "0002_more.sql").write_text("CREATE TABLE bar (id INTEGER PRIMARY KEY);")
    assert runner.status(conn, mig_dir) == {"applied": [], "pending": [1, 2]}
    runner.migrate(conn, mig_dir)
    assert runner.status(conn, mig_dir) == {"applied": [1, 2], "pending": []}


def test_dry_run_does_not_apply(conn, mig_dir):
    assert runner.migrate(conn, mig_dir, dry_run=True) == [1]
    assert runner.applied_versions(conn) == set()


def test_unknown_version_files_are_ignored(conn, mig_dir):
    (mig_dir / "notes.sql").write_text("-- arquivo sem versão")
    assert runner.discover_migrations(mig_dir) == [(1, mig_dir / "0001_init.sql")]


# ------------------------------------------------- shipped migrations


def test_shipped_migrations_build_current_schema(tmp_path):
    target = sqlite3.connect(tmp_path / "fresh.sqlite3")
    try:
        new = runner.migrate(target, runner.MIGRATIONS_DIR)
        assert new == [1, 2]
        assert runner.SCHEMA_VERSION == 2
        tables = {
            row[0]
            for row in target.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert {
            "kv",
            "workspaces",
            "director_queue",
            "history",
            "productions",
            "runs",
            "production_events",
            "schema_version",
        } <= tables
        run_columns = {
            row[1] for row in target.execute("PRAGMA table_info(runs)")
        }
        assert "interrupted_at" in run_columns
    finally:
        target.close()


def test_shipped_migrations_are_idempotent(tmp_path):
    target = sqlite3.connect(tmp_path / "fresh.sqlite3")
    try:
        assert runner.migrate(target, runner.MIGRATIONS_DIR) == [1, 2]
        assert runner.migrate(target, runner.MIGRATIONS_DIR) == []
    finally:
        target.close()


def test_migration_on_copy_of_bootstrapped_database(tmp_path):
    """Spec scenario: run the migration over a copy of the user's DB."""
    db_path = tmp_path / "user.sqlite3"
    db = AppStateDB(db_path)
    db.kv_set("theme", "dark")
    db.upsert_workspace("alpha", "/tmp/alpha")

    copy = tmp_path / "copy.sqlite3"
    import shutil

    shutil.copy2(db_path, copy)
    target = sqlite3.connect(copy)
    try:
        new = runner.migrate(target, runner.MIGRATIONS_DIR)
        # The DDL is a no-op on existing tables (IF NOT EXISTS) but the
        # runner records both file versions in its schema_version table.
        assert new == [1, 2]
        # Existing data survived the overlay.
        row = target.execute("SELECT value FROM kv WHERE key='theme'").fetchone()
        assert row is not None
    finally:
        target.close()


def test_default_db_path_still_falls_back(tmp_path, monkeypatch):
    monkeypatch.delenv("APP_SQLITE_PATH", raising=False)
    monkeypatch.delenv("APP_CACHE_DIR", raising=False)
    assert get_default_db_path() == ROOT / "app" / ".cache" / "app_state.sqlite3"


# ------------------------------------------------------ backup/restore


@pytest.fixture
def scripts():
    sys.path.insert(0, str(ROOT / "scripts"))
    import backup
    import restore

    return backup, restore


def test_backup_restore_roundtrip_preserves_state(tmp_path, scripts):
    backup, restore = scripts
    db_path = tmp_path / "state.sqlite3"
    db = ProductionStore(db_path)
    db.upsert_pipeline(
        {
            "pipeline_id": "pipe-b1",
            "status": "running",
            "workspace": "ws-1",
            "output_files": [],
        }
    )

    saved = backup.backup_db(db_path, tmp_path / "backups" / "state.sqlite3")
    assert saved.is_file()

    # Mutate after the backup…
    db.upsert_pipeline(
        {
            "pipeline_id": "pipe-b2",
            "status": "completed",
            "workspace": "ws-1",
            "output_files": [],
        }
    )
    assert len(db.list_productions()) == 2

    # …then restore: the mutation is rolled back, prior state preserved.
    restore.restore_db(saved, db_path)
    reopened = ProductionStore(db_path)
    assert len(reopened.list_productions()) == 1  # pipe-b2 never happened
    pipelines = reopened.catalog()["runs"]
    assert {r["correlations"]["pipeline_id"] for r in pipelines} == {"pipe-b1"}


def test_restore_keeps_pre_restore_copy(tmp_path, scripts):
    backup, restore = scripts
    db_path = tmp_path / "state.sqlite3"
    AppStateDB(db_path).kv_set("k", "before")
    saved = backup.backup_db(db_path, tmp_path / "b.sqlite3")
    AppStateDB(db_path).kv_set("k", "after")

    restore.restore_db(saved, db_path)
    assert (tmp_path / "state.sqlite3.pre-restore").is_file()
    assert AppStateDB(db_path).kv_get("k") == "before"


def test_restore_rejects_non_database_file(tmp_path, scripts):
    _backup, restore = scripts
    bogus = tmp_path / "not-a-db.sqlite3"
    bogus.write_text("hello")
    with pytest.raises(sqlite3.DatabaseError):
        restore.restore_db(bogus, tmp_path / "state.sqlite3")


def test_backup_missing_source_raises(tmp_path, scripts):
    backup, _restore = scripts
    with pytest.raises(FileNotFoundError):
        backup.backup_db(tmp_path / "missing.sqlite3", tmp_path / "out.sqlite3")
