#!/usr/bin/env python3
"""Prune stale ``demo_local_skill_*`` plugin directories.

Why this exists
---------------
The Director plugin system lets a user add local skills under
``app/services/director/plugins/demo_local_skill_<suffix>/``. While
developing and testing, the team accumulates dozens of these
directories that are never used in production. They ship in the repo
because ``.gitignore`` keeps them untracked, but they still take up
disk space on every developer machine and confuse new contributors.

This script keeps at most ``--keep N`` of the most recently modified
directories (default 4) and removes the rest. It is intentionally
conservative: it never touches anything outside
``app/services/director/plugins/``, never deletes a directory whose
name doesn't start with ``demo_local_skill_``, and prints the list of
victims before doing anything destructive.

Usage::

    python scripts/prune_demo_local_skills.py --keep 4
    python scripts/prune_demo_local_skills.py --keep 0 --dry-run
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = REPO_ROOT / "app" / "services" / "director" / "plugins"


def _candidate_dirs(plugins_dir: Path) -> list[Path]:
    """Return every ``demo_local_skill_*`` subdirectory under plugins."""

    if not plugins_dir.is_dir():
        return []
    return sorted(
        child
        for child in plugins_dir.iterdir()
        if child.is_dir() and child.name.startswith("demo_local_skill_")
    )


def prune(keep: int, dry_run: bool) -> list[Path]:
    """Remove every demo plugin except the ``keep`` most recent ones."""

    candidates = _candidate_dirs(PLUGINS_DIR)
    # Sort by mtime descending; we keep the newest ``keep`` entries
    # and remove the rest.
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    victims = candidates[keep:]

    if dry_run:
        for victim in victims:
            print(f"[dry-run] would remove {victim}")
        return victims

    for victim in victims:
        shutil.rmtree(victim, ignore_errors=True)
        print(f"removed {victim}")
    return victims


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keep",
        type=int,
        default=4,
        help="Number of most-recent demo plugins to keep (default: 4).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the would-be victims without removing anything.",
    )
    args = parser.parse_args()

    if args.keep < 0:
        print("error: --keep must be non-negative", file=sys.stderr)
        return 2

    victims = prune(args.keep, args.dry_run)
    if victims and not args.dry_run:
        print(f"Pruned {len(victims)} demo plugin(s).")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
