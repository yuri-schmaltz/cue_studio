"""Cue Studio console entry — loaded as ``cue_studio`` / ``cue`` scripts.

Kept at the repository root so the pyproject ``[project.scripts]``
table can resolve ``cue_studio_cli:main`` after a pip ``-e`` install
without copying app.cli. ``app.cli.main`` already does the work; this
file just delegates and adds the repo root to ``sys.path`` so the
``app`` package is importable in dev / editable installs.
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.cli import main  # noqa: E402  (sys.path mutated intentionally)


if __name__ == "__main__":
    raise SystemExit(main())
