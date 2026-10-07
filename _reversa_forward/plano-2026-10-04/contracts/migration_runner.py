"""Runner de migrações SQLite (A18).

Idempotente: rodar duas vezes não falha.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterable
from pathlib import Path


VERSION_PATTERN = re.compile(r"^(\d+)_")


def applied_versions(conn: sqlite3.Connection) -> set[int]:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version ("
        "v INTEGER PRIMARY KEY, applied_at REAL NOT NULL)"
    )
    conn.commit()
    return {row[0] for row in conn.execute("SELECT v FROM schema_version")}


def discover_migrations(directory: Path) -> list[tuple[int, Path]]:
    out: list[tuple[int, Path]] = []
    for f in sorted(directory.glob("*.sql")):
        m = VERSION_PATTERN.match(f.stem)
        if not m:
            continue
        out.append((int(m.group(1)), f))
    return out


def migrate(
    conn: sqlite3.Connection,
    directory: Path,
    *,
    dry_run: bool = False,
) -> list[int]:
    """Aplica migrações pendentes. Retorna versões aplicadas."""
    applied = applied_versions(conn)
    new: list[int] = []
    for version, path in discover_migrations(directory):
        if version in applied:
            continue
        sql = path.read_text()
        if dry_run:
            new.append(version)
            continue
        try:
            conn.executescript(sql)
        except sqlite3.Error:
            conn.rollback()
            raise
        conn.execute(
            "INSERT INTO schema_version (v, applied_at) VALUES (?, strftime('%s','now'))",
            (version,),
        )
        conn.commit()
        new.append(version)
    return new


def status(conn: sqlite3.Connection, directory: Path) -> dict[str, list[int]]:
    """Retorna dicionário com aplicadas e pendentes."""
    applied = applied_versions(conn)
    pend = [v for v, _ in discover_migrations(directory) if v not in applied]
    return {"applied": sorted(applied), "pending": sorted(pend)}