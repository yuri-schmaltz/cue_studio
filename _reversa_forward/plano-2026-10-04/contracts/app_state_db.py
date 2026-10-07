"""Contrato para `app_state_db` (A06, A18).

Garante que o caminho do singleton é decidido por env var e que testes
não tocam o cache real do usuário.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path


DEFAULT_DB_NAME = "app_state.sqlite3"
TEST_DB_FALLBACK = ":memory:"


def get_default_db_path() -> Path:
    """Resolve o caminho do banco a partir de `APP_SQLITE_PATH` ou workspace."""
    override = os.environ.get("APP_SQLITE_PATH")
    if override:
        return Path(override)
    workspace = os.environ.get("CUE_WORKSPACE_DIR")
    if workspace:
        return Path(workspace) / ".cache" / DEFAULT_DB_NAME
    return Path.cwd() / ".cache" / DEFAULT_DB_NAME


def make_connection(path: Path | None = None) -> sqlite3.Connection:
    """Cria uma conexão no caminho dado ou no caminho resolvido."""
    resolved = path or get_default_db_path()
    if str(resolved) == TEST_DB_FALLBACK:
        return sqlite3.connect(":memory:")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(resolved)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def in_test_mode() -> bool:
    """Heurística: detecta se o app está rodando sob suíte de testes."""
    return (
        os.environ.get("CUE_TEST_MODE") == "1"
        or os.environ.get("APP_SQLITE_PATH", "").startswith("/tmp")
        or os.environ.get("APP_SQLITE_PATH", "").startswith("/var/folders")
    )