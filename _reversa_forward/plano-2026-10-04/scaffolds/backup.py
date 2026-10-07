#!/usr/bin/env python3
"""Backup script (A18). Backup do SQLite + JSON legados em um único arquivo tar.gz."""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
import tempfile
import tarfile
from datetime import datetime
from pathlib import Path


def backup_db(db_path: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{db_path.name}.bak"
    if not db_path.exists():
        return target
    # Consistent backup via SQLite
    src = sqlite3.connect(str(db_path))
    dst = sqlite3.connect(str(target))
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    return target


def main() -> int:
    p = argparse.ArgumentParser(description="Backup do Cue Studio")
    p.add_argument("--db", required=True, type=Path, help="Caminho do SQLite")
    p.add_argument("--media-root", type=Path, help="Diretório de mídias (opcional)")
    p.add_argument("--out", required=True, type=Path, help="Arquivo .tar.gz de saída")
    p.add_argument("--tmp", type=Path, help="Diretório temporário (default: tempfile)")
    args = p.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="cue-studio-backup-")) if not args.tmp else args.tmp
    try:
        backup_db(args.db, tmp)
        if args.media_root and args.media_root.exists():
            shutil.copytree(args.media_root, tmp / "media", dirs_exist_ok=True)

        meta = tmp / "META.txt"
        meta.write_text(
            f"created_at={datetime.now().isoformat()}\n"
            f"db={args.db}\n"
            f"media_root={args.media_root}\n"
        )

        args.out.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(args.out, "w:gz") as tar:
            tar.add(tmp, arcname=".")
        print(f"backup written: {args.out}")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())