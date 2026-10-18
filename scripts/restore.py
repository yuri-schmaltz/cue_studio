#!/usr/bin/env python
"""Restore a Cue Studio app-state database from a backup (A18).

Counterpart of ``scripts/backup.py``: copies a backup file over the
live database path (default: the ``app_state_db`` resolution, honoring
``APP_SQLITE_PATH`` / ``APP_CACHE_DIR``). The backup is validated as a
readable SQLite database *before* anything is overwritten, and the
previous database is kept as ``<db>.pre-restore`` so a bad restore is
itself recoverable.

Usage::

    python scripts/restore.py --backup backups/app_state-20261018-120000.sqlite3
    python scripts/restore.py --backup b.sqlite3 --db-path /path/to/db
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "app") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "app"))


def validate_backup(backup: Path | str) -> None:
    """Raise if the file is not a readable SQLite database."""
    conn = sqlite3.connect(f"file:{backup}?mode=ro", uri=True)
    try:
        conn.execute("SELECT count(*) FROM sqlite_master")
    finally:
        conn.close()


def restore_db(backup: Path | str, dest: Path | str) -> Path:
    """Overwrite ``dest`` with ``backup``. Returns ``dest``.

    A pre-existing ``dest`` is preserved as ``<dest>.pre-restore``.
    """
    backup = Path(backup)
    dest = Path(dest)
    if not backup.is_file():
        raise FileNotFoundError(f"backup not found: {backup}")
    validate_backup(backup)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.copy2(dest, dest.with_name(dest.name + ".pre-restore"))
    # Remove stale WAL/SHM sidecars so the restored file is authoritative.
    for suffix in ("-wal", "-shm"):
        sidecar = dest.with_name(dest.name + suffix)
        if sidecar.exists():
            sidecar.unlink()
    shutil.copy2(backup, dest)
    return dest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--backup", required=True, help="backup file to restore from")
    parser.add_argument("--db-path", default=None, help="destination database (default: app_state_db default)")
    args = parser.parse_args(argv)

    if args.db_path:
        dest = Path(args.db_path)
    else:
        from services.app_state_db import get_default_db_path

        dest = get_default_db_path()

    restored = restore_db(args.backup, dest)
    print(f"[restore] {args.backup} -> {restored}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
