"""Cue Studio console entry — loaded as ``cue-studio`` / ``cue`` scripts.

Lives as ``cue_studio_cli/__init__.py`` so the pyproject
``[project.scripts]`` table can resolve ``cue_studio_cli:main`` after a
pip ``-e`` install without copying ``app.cli``. The setuptools
``[tool.setuptools]`` ``packages`` entry picks up this directory and
installs it next to ``app``; ``app.cli.main`` does the real work and
this module just adds the repo root to ``sys.path`` and delegates.

Run directly from a dev checkout: ``python -m cue_studio_cli status``
Via pip console script: ``cue-studio status`` (after `pip install -e .`)
"""
from __future__ import annotations

import sys
from pathlib import Path

# Repo root is the parent of this package directory; the standalone
# launcher (start.sh) `cd`s into app/ and runs launch.py, which
# requires absolute imports like ``from services import ...`` to resolve
# relative to app/. We mirror that here by adding the repo root to
# sys.path so ``app`` becomes importable as a top-level package.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.cli import main  # noqa: E402  (sys.path mutated intentionally)


if __name__ == "__main__":
    raise SystemExit(main())
