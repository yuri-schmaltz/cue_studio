#!/usr/bin/env python3
"""Restore script (A18). Restaura SQLite + mídias a partir de um .tar.gz."""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
import tarfile
import tempfile
from pathlib import Path


def restore_db(backup_path: Path, target_db: Path) -> None:
    target_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(backup_path, target_db)


def main() -> int:
    p = argparse.ArgumentParser(description="Restore do Cue Studio")
    p.add_argument("--archive", required=True, type=Path, help="Arquivo .tar.gz")
    p.add_argument("--db", required=True, type=Path, help="Caminho destino do SQLite")
    p.add_argument("--media-root", type=Path, help="Diretório destino de mídias")
    p.add_argument("--force", action="store_true", help="Sobrescreve destino existente")
    args = p.parse_args()

    if not args.archive.exists():
        print(f"ERROR: archive {args.archive} missing", file=sys.stderr)
        return 1

    tmp = Path(tempfile.mkdtemp(prefix="cue-studio-restore-"))
    try:
        with tarfile.open(args.archive, "r:gz") as tar:
            tar.extractall(tmp)
        # O nome do banco no backup reflete o nome original do db.
        # Procuramos qualquer .bak no arquivo.
        backups = list(tmp.glob("*.bak"))
        if backups:
            backup = backups[0]
            if args.db.exists() and not args.force:
                print(f"ERROR: {args.db} already exists. Use --force.", file=sys.stderr)
                return 2
            restore_db(backup, args.db)

        media_src = tmp / "media"
        if args.media_root and media_src.exists():
            if args.media_root.exists() and not args.force:
                print(f"WARNING: {args.media_root} exists; merging.")
            shutil.copytree(media_src, args.media_root, dirs_exist_ok=True)
        print(f"restored from {args.archive}")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())