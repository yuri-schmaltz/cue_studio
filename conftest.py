"""Pytest configuration — adds app/ to sys.path so absolute imports
like `from services.director.cinema import ...` resolve.

Why this lives at the repo root and not in tests/: pytest's
sys.path manipulation order is rootdir-first; a tests/conftest.py
runs AFTER the rootdir conftest has already been processed, which
is too late to influence collection of tests/ siblings. By sitting
at the repo root, this conftest hooks the sys.path before any test
module gets imported.

Maestro's standalone launcher (start.sh) `cd`s into app/
and runs `python launch.py`, so its absolute imports (e.g. `from
services import safe_download`) resolve relative to that cwd. We
mirror that behaviour here: any test that needs `launch.py` (or
modules that import it directly) gets `app/` on sys.path so the
same absolute imports keep working.

We also prepend the repo root so `import cue_studio_cli` (the
pip-installed console-script shim package) is importable from the
test-suite.
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent
_APP_DIR = _REPO_ROOT / "app"

for _path in (str(_APP_DIR), str(_REPO_ROOT)):
    if _path not in sys.path:
        sys.path.insert(0, _path)
