"""A06 — test-suite isolation from the real ``app/.cache`` directory.

Verifies the contract from
``_reversa_forward/plano-2026-10-04/12-feature-a06-test-isolation.md``:

* the singleton DB path resolves through ``APP_SQLITE_PATH`` /
  ``APP_CACHE_DIR`` with a fallback to ``<app>/.cache``;
* the autouse ``isolate_singletons`` fixture (tests/conftest.py) points
  every default-constructed store into the test's ``tmp_path``;
* no default-constructed store resolves to the real ``app/.cache``.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

# NOTE: import via `app.services.*` (not `services.*`) on purpose — loading
# the short-name module instances first would make later dual-context
# resolvers (production_resume, routers) bind to a different class object.
from app.services import app_state_db, model_catalog_cache, production_store  # noqa: E402

REAL_CACHE_DIR = ROOT / "app" / ".cache"


class TestDefaultPathResolution:
    def test_app_sqlite_path_wins(self, monkeypatch, tmp_path):
        override = tmp_path / "explicit.sqlite3"
        monkeypatch.setenv("APP_SQLITE_PATH", str(override))
        assert app_state_db.get_default_db_path() == override

    def test_app_cache_dir_used_for_db(self, monkeypatch, tmp_path):
        monkeypatch.delenv("APP_SQLITE_PATH", raising=False)
        monkeypatch.setenv("APP_CACHE_DIR", str(tmp_path / "cache"))
        assert app_state_db.get_default_db_path() == tmp_path / "cache" / "app_state.sqlite3"

    def test_fallback_is_real_cache_dir(self, monkeypatch):
        monkeypatch.delenv("APP_SQLITE_PATH", raising=False)
        monkeypatch.delenv("APP_CACHE_DIR", raising=False)
        assert app_state_db.get_default_db_path() == REAL_CACHE_DIR / "app_state.sqlite3"
        assert app_state_db.get_default_cache_dir() == REAL_CACHE_DIR

    def test_production_store_shares_resolution(self, monkeypatch, tmp_path):
        monkeypatch.setenv("APP_SQLITE_PATH", str(tmp_path / "shared.sqlite3"))
        assert production_store._default_db_path() == tmp_path / "shared.sqlite3"

    def test_model_catalog_cache_honors_cache_dir(self, monkeypatch, tmp_path):
        monkeypatch.setenv("APP_CACHE_DIR", str(tmp_path / "cache"))
        assert (
            model_catalog_cache._default_cache_path()
            == tmp_path / "cache" / "model_catalog.sqlite3"
        )


class TestFixtureIsolation:
    def test_env_points_into_tmp_path(self, tmp_path):
        # The autouse isolate_singletons fixture must have repointed the
        # env vars at this test's tmp_path before the test body ran.
        assert os.environ["APP_SQLITE_PATH"] == str(tmp_path / "app_state.sqlite3")
        assert os.environ["APP_CACHE_DIR"] == str(tmp_path / "cache")

    def test_default_constructor_writes_inside_tmp_path(self, tmp_path):
        db = app_state_db.AppStateDB()  # no args — uses APP_SQLITE_PATH
        assert db.stats()["path"] == str(tmp_path / "app_state.sqlite3")
        assert not str(tmp_path).startswith(str(REAL_CACHE_DIR))

    def test_singleton_is_isolated_and_resettable(self):
        app_state_db.reset_app_state_db_singleton()
        a = app_state_db.get_app_state_db()
        b = app_state_db.get_app_state_db()
        assert a is b
        path = Path(a.stats()["path"])
        # tmp_path is pytest's per-test dir under the system temp root.
        assert not path.is_relative_to(REAL_CACHE_DIR)
        assert not path.is_relative_to(ROOT / ".cache")

    def test_production_store_default_is_isolated(self):
        store = production_store.ProductionStore()
        assert not Path(store._db_path).is_relative_to(REAL_CACHE_DIR)

    def test_model_catalog_cache_default_is_isolated(self):
        cache = model_catalog_cache.ModelCatalogCache()
        assert not Path(cache._db_path).is_relative_to(REAL_CACHE_DIR)
