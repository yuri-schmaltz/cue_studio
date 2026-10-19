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
import copy
import json
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

# Layer 1: import-time isolation (see module docstring).
_SESSION_TMP_ROOT = Path(tempfile.mkdtemp(prefix="cue-studio-tests-"))
os.environ["APP_SQLITE_PATH"] = str(_SESSION_TMP_ROOT / "app_state.sqlite3")
os.environ["APP_CACHE_DIR"] = str(_SESSION_TMP_ROOT / "cache")

# launch.py also persists wgp_config.json (workspaces and Studio preferences).
# Cache/SQLite isolation alone does not protect the developer's configuration.
_CONFIG_DIR = _SESSION_TMP_ROOT / "config"
_CONFIG_DIR.mkdir()
_source_config = Path(__file__).resolve().parents[1] / "app" / "wgp_config.json"
try:
    _test_config = json.loads(_source_config.read_text())
except (OSError, ValueError):
    _test_config = {}
_test_outputs = _SESSION_TMP_ROOT / "outputs"
_test_outputs.mkdir()
for _key in ("save_path", "image_save_path", "audio_save_path"):
    _test_config[_key] = str(_test_outputs)
_test_config.setdefault("services", {}).update(
    projects_root_path=str(_test_outputs), active_workspace="default",
    projects_root_healed=True,
)
(_CONFIG_DIR / "wgp_config.json").write_text(json.dumps(_test_config))
os.environ["CUE_CONFIG_DIR"] = str(_CONFIG_DIR)

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
    for module_name in ("wgp", "app.wgp"):
        runtime = sys.modules.get(module_name)
        if runtime is not None and isinstance(getattr(runtime, "server_config", None), dict):
            monkeypatch.setattr(runtime, "server_config", copy.deepcopy(runtime.server_config))
            monkeypatch.setattr(runtime, "server_config_filename", str(tmp_path / "wgp_config.json"))
    yield
    _reset_db_singletons()


def pytest_sessionfinish(session, exitstatus):  # noqa: D103
    shutil.rmtree(_SESSION_TMP_ROOT, ignore_errors=True)
