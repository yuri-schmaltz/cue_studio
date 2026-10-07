"""Testes do contrato `app_state_db` (A06)."""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))

from app_state_db import (  # noqa: E402
    DEFAULT_DB_NAME,
    get_default_db_path,
    in_test_mode,
    make_connection,
)


def test_env_override_is_honored(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_SQLITE_PATH", str(tmp_path / "x.sqlite3"))
    p = get_default_db_path()
    assert p == tmp_path / "x.sqlite3"


def test_workspace_fallback(monkeypatch) -> None:
    monkeypatch.delenv("APP_SQLITE_PATH", raising=False)
    monkeypatch.setenv("CUE_WORKSPACE_DIR", "/tmp/cue-ws")
    p = get_default_db_path()
    assert p == Path("/tmp/cue-ws/.cache/app_state.sqlite3")


def test_default_path_does_not_touch_user_cache_when_env_set(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("APP_SQLITE_PATH", str(tmp_path / "isolated.sqlite3"))
    conn = make_connection()
    conn.execute("CREATE TABLE kv (k TEXT PRIMARY KEY)")
    conn.commit()
    conn.close()
    # nada em cwd
    assert not (Path.cwd() / ".cache" / DEFAULT_DB_NAME).exists()


def test_in_test_mode_detection(monkeypatch) -> None:
    monkeypatch.setenv("CUE_TEST_MODE", "1")
    assert in_test_mode() is True
    monkeypatch.delenv("CUE_TEST_MODE", raising=False)
    monkeypatch.setenv("APP_SQLITE_PATH", "/tmp/foo.sqlite3")
    assert in_test_mode() is True


def test_make_connection_in_memory() -> None:
    conn = make_connection(Path(":memory:"))
    assert conn.execute("SELECT 1").fetchone() == (1,)