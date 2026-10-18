"""Suite-wide isolation fixtures (A06).

Two layers keep the test suite from ever touching the developer's real
``app/.cache`` directory:

1. **Import time** — pytest imports this conftest *before* collecting any
   test module, and some test modules import ``app/launch.py`` (which
   builds ``ProductionStore()`` / ``AppStateDB()`` at module scope).
   Setting ``APP_SQLITE_PATH`` / ``APP_CACHE_DIR`` here — before any test
   module is imported — guarantees even collection-time singletons resolve
   into a throwaway session temp dir.

2. **Per-test** — the autouse ``isolate_singletons`` fixture repoints both
   env vars at the test's own ``tmp_path`` and drops any cached DB/cache
   singletons, so every test starts from a fresh, private database.

``APP_CACHE_DIR`` is honored by :func:`services.app_state_db.get_default_cache_dir`
which backs all ``<app>/.cache`` SQLite files (app_state, model_catalog).
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

# Layer 1: import-time isolation (see module docstring).
_SESSION_TMP_ROOT = Path(tempfile.mkdtemp(prefix="cue-studio-tests-"))
os.environ["APP_SQLITE_PATH"] = str(_SESSION_TMP_ROOT / "app_state.sqlite3")
os.environ["APP_CACHE_DIR"] = str(_SESSION_TMP_ROOT / "cache")

# Both `services.*` (launch.py) and `app.services.*` (pytest) module
# contexts can be loaded in one process; reset singletons in whichever
# instances are present.
_SINGLETON_RESETTERS = (
    ("services.app_state_db", "reset_app_state_db_singleton"),
    ("app.services.app_state_db", "reset_app_state_db_singleton"),
    ("services.model_catalog_cache", "reset_cache_singleton"),
    ("app.services.model_catalog_cache", "reset_cache_singleton"),
)


def _reset_db_singletons() -> None:
    for module_name, resetter in _SINGLETON_RESETTERS:
        module = sys.modules.get(module_name)
        if module is None:
            continue
        fn = getattr(module, resetter, None)
        if fn is not None:
            fn()


@pytest.fixture(autouse=True)
def isolate_singletons(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point every singleton DB/cache at this test's ``tmp_path``."""
    monkeypatch.setenv("APP_SQLITE_PATH", str(tmp_path / "app_state.sqlite3"))
    monkeypatch.setenv("APP_CACHE_DIR", str(tmp_path / "cache"))
    _reset_db_singletons()
    yield
    _reset_db_singletons()


def pytest_sessionfinish(session, exitstatus):  # noqa: D103
    shutil.rmtree(_SESSION_TMP_ROOT, ignore_errors=True)
