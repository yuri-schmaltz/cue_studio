"""Testes do runner de migrações (A18)."""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))

from migration_runner import migrate, status, discover_migrations  # noqa: E402


def _conn_in_tmp(tmp: Path) -> sqlite3.Connection:
    db = tmp / "test.sqlite3"
    return sqlite3.connect(db)


def test_migrate_from_empty(tmp_path: Path) -> None:
    conn = _conn_in_tmp(tmp_path)
    mig_dir = tmp_path / "mig"
    mig_dir.mkdir()
    (mig_dir / "0001_init.sql").write_text(
        "CREATE TABLE foo (id INTEGER PRIMARY KEY);"
    )
    new = migrate(conn, mig_dir)
    assert new == [1], new
    assert {row[0] for row in conn.execute("SELECT v FROM schema_version")} == {1}


def test_migrate_is_idempotent(tmp_path: Path) -> None:
    conn = _conn_in_tmp(tmp_path)
    mig_dir = tmp_path / "mig"
    mig_dir.mkdir()
    (mig_dir / "0001_init.sql").write_text(
        "CREATE TABLE foo (id INTEGER PRIMARY KEY);"
    )
    first = migrate(conn, mig_dir)
    second = migrate(conn, mig_dir)
    assert first == [1]
    assert second == []


def test_status_reports_applied_and_pending(tmp_path: Path) -> None:
    conn = _conn_in_tmp(tmp_path)
    mig_dir = tmp_path / "mig"
    mig_dir.mkdir()
    (mig_dir / "0001_init.sql").write_text(
        "CREATE TABLE foo (id INTEGER PRIMARY KEY);"
    )
    (mig_dir / "0002_more.sql").write_text(
        "CREATE TABLE bar (id INTEGER PRIMARY KEY);"
    )
    s0 = status(conn, mig_dir)
    assert s0 == {"applied": [], "pending": [1, 2]}, s0
    migrate(conn, mig_dir)
    s1 = status(conn, mig_dir)
    assert s1 == {"applied": [1, 2], "pending": []}, s1


def test_dry_run_does_not_apply(tmp_path: Path) -> None:
    conn = _conn_in_tmp(tmp_path)
    mig_dir = tmp_path / "mig"
    mig_dir.mkdir()
    (mig_dir / "0001_init.sql").write_text(
        "CREATE TABLE foo (id INTEGER PRIMARY KEY);"
    )
    new = migrate(conn, mig_dir, dry_run=True)
    assert new == [1]
    # Nada foi aplicado de fato
    assert {row[0] for row in conn.execute("SELECT v FROM schema_version")} == set()


def test_unknown_version_files_are_ignored(tmp_path: Path) -> None:
    conn = _conn_in_tmp(tmp_path)
    mig_dir = tmp_path / "mig"
    mig_dir.mkdir()
    (mig_dir / "0001_init.sql").write_text(
        "CREATE TABLE foo (id INTEGER PRIMARY KEY);"
    )
    (mig_dir / "notes.sql").write_text("-- arquivo sem versão")
    out = discover_migrations(mig_dir)
    assert out == [(1, mig_dir / "0001_init.sql")]