#!/usr/bin/env python3
"""Protótipo isolado de migrações (A18).

Implementa um mini-runner de migrações **sem dependências externas** e
verifica idempotência rodando o mesmo conjunto duas vezes.

Rodar:
  python3 _reversa_forward/plano-2026-10-04/prototypes/a18_persistence.py
"""
from __future__ import annotations

import sqlite3
import sys
import tempfile
from pathlib import Path


SCHEMA_VERSION = 2

MIGRATIONS = {
    1: """
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at REAL NOT NULL
    );
    """,
    2: """
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      state TEXT NOT NULL,
      updated_at REAL NOT NULL
    );
    """,
}


def get_applied_versions(conn: sqlite3.Connection) -> set[int]:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (v INTEGER PRIMARY KEY)"
    )
    conn.commit()
    return {row[0] for row in conn.execute("SELECT v FROM schema_version")}


def migrate(conn: sqlite3.Connection) -> list[int]:
    applied = get_applied_versions(conn)
    new: list[int] = []
    for v in sorted(MIGRATIONS):
        if v in applied:
            continue
        conn.executescript(MIGRATIONS[v])
        conn.execute("INSERT INTO schema_version (v) VALUES (?)", (v,))
        new.append(v)
    conn.commit()
    return new


def test_migrate_from_empty() -> None:
    with tempfile.TemporaryDirectory() as d:
        db_path = Path(d) / "test.sqlite3"
        conn = sqlite3.connect(db_path)
        new = migrate(conn)
        conn.close()
        assert new == [1, 2], new
    print("OK migrate_from_empty")


def test_migrate_is_idempotent() -> None:
    with tempfile.TemporaryDirectory() as d:
        db_path = Path(d) / "test.sqlite3"
        conn = sqlite3.connect(db_path)
        first = migrate(conn)
        second = migrate(conn)
        conn.close()
        assert first == [1, 2], first
        assert second == [], second
    print("OK migrate_is_idempotent")


def test_migrate_creates_expected_tables() -> None:
    with tempfile.TemporaryDirectory() as d:
        db_path = Path(d) / "test.sqlite3"
        conn = sqlite3.connect(db_path)
        migrate(conn)
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        conn.close()
        assert {"projects", "queue", "schema_version"}.issubset(tables), tables
    print("OK migrate_creates_expected_tables")


def main() -> int:
    tests = [
        test_migrate_from_empty,
        test_migrate_is_idempotent,
        test_migrate_creates_expected_tables,
    ]
    failures = 0
    for t in tests:
        try:
            t()
        except AssertionError as e:
            failures += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR {t.__name__}: {e}")
    print(f"\n{len(tests)} tests run; failures={failures}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())