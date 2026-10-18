"""Runner de migrações SQLite (A18).

Idempotente: rodar duas vezes não falha. Adapted from the spec contract
(``_reversa_forward/plano-2026-10-04/contracts/migration_runner.py``) with
one addition: :data:`SCHEMA_VERSION` reports the latest version shipped
in :data:`MIGRATIONS_DIR`.

Coexistence with ``services.app_state_db``: that module keeps its own
inline ``migrations`` table and boot-time application. These SQL files
use ``IF NOT EXISTS`` everywhere, so overlaying them on a database that
was already migrated by ``app_state_db`` is a safe no-op, and the
runner's ``schema_version`` table tracks the file-based versions
independently.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

__all__ = [
    "MIGRATIONS_DIR",
    "SCHEMA_VERSION",
    "applied_versions",
    "discover_migrations",
    "migrate",
    "status",
]

MIGRATIONS_DIR = Path(__file__).resolve().parent

# Latest version shipped with the app; bump when adding a new *.sql file.
SCHEMA_VERSION = 2

VERSION_PATTERN = re.compile(r"^(\d+)_")


def applied_versions(conn: sqlite3.Connection) -> set[int]:
    """Create the tracking table if needed and return applied versions."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version ("
        "v INTEGER PRIMARY KEY, applied_at REAL NOT NULL)"
    )
    conn.commit()
    return {row[0] for row in conn.execute("SELECT v FROM schema_version")}


def discover_migrations(directory: Path) -> list[tuple[int, Path]]:
    """Ordered (version, path) pairs for ``NNNN_*.sql`` files."""
    out: list[tuple[int, Path]] = []
    for f in sorted(Path(directory).glob("*.sql")):
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
        sql = path.read_text(encoding="utf-8")
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
