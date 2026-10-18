#!/usr/bin/env python
"""Consistent SQLite backup for the Cue Studio app-state database (A18).

Uses the SQLite online backup API so the copy is consistent even while
the WAL journal is active — a plain ``cp`` of the .sqlite3 file can miss
recent commits or race a writer.

Usage::

    python scripts/backup.py                 # backup default DB to ./backups/
    python scripts/backup.py --dest out.db   # explicit destination
    python scripts/backup.py --db-path /path/to/app_state.sqlite3

The source path resolves through ``services.app_state_db`` and therefore
honors the ``APP_SQLITE_PATH`` / ``APP_CACHE_DIR`` overrides (A06), which
is what makes backup/restore testable against isolated copies.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "app") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "app"))


def default_backup_dir() -> Path:
    return REPO_ROOT / "backups"


def backup_db(src: Path | str, dest: Path | str) -> Path:
    """Copy ``src`` SQLite database to ``dest``. Returns the destination.

    Raises ``FileNotFoundError`` when the source does not exist and
    ``sqlite3.Error`` when either side is not a readable database.
    """
    src = Path(src)
    dest = Path(dest)
    if not src.is_file():
        raise FileNotFoundError(f"database not found: {src}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(str(src), timeout=10.0)
    try:
        target = sqlite3.connect(str(dest))
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()
    return dest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db-path", default=None, help="source database (default: app_state_db default)")
    parser.add_argument("--dest", default=None, help="destination file (default: backups/app_state-<timestamp>.sqlite3)")
    args = parser.parse_args(argv)

    if args.db_path:
        src = Path(args.db_path)
    else:
        from services.app_state_db import get_default_db_path

        src = get_default_db_path()

    if args.dest:
        dest = Path(args.dest)
    else:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        dest = default_backup_dir() / f"app_state-{stamp}.sqlite3"

    written = backup_db(src, dest)
    print(f"[backup] {src} -> {written}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
