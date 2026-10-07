#!/usr/bin/env python3
"""Protótipo isolado de isolamento de testes (A06).

Demonstra a estratégia proposta para resolver o achado D10:

  - O caminho do singleton de banco deve ser resolvido por variável de
    ambiente `APP_SQLITE_PATH`, com fallback seguro.
  - Em testes, monkeypatch garante que o singleton use `tmp_path`,
    eliminando o incidente em que `tests/test_app_state_db.py` tocou o
    cache SQLite real do usuário.

Este script **não** importa o código de `app/` (que não deve ser modificado
sob a política atual). Em vez disso, ele reproduz a interface mínima do
singleton e mostra que o contrato proposto funciona.

Rodar com:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a06_test_isolation.py
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path


class AppStateDB:
    """Stub do singleton, reproduzindo o contrato esperado por A06."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)"
        )
        self._conn.commit()

    @property
    def path(self) -> Path:
        return self._path

    def set(self, k: str, v: str) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", (k, v)
        )
        self._conn.commit()

    def get(self, k: str) -> str | None:
        cur = self._conn.execute("SELECT v FROM kv WHERE k = ?", (k,))
        row = cur.fetchone()
        return row[0] if row else None

    def close(self) -> None:
        self._conn.close()


def get_default_db_path() -> Path:
    """Resolve o caminho do singleton respeitando env var."""
    override = os.environ.get("APP_SQLITE_PATH")
    if override:
        return Path(override)
    # fallback idêntico ao comportamento atual em dev
    return Path.cwd() / ".cache" / "app_state.sqlite3"


def make_default_db() -> AppStateDB:
    return AppStateDB(get_default_db_path())


def test_default_db_uses_env_override(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_SQLITE_PATH", str(tmp_path / "isolated.sqlite3"))
    db = make_default_db()
    db.set("project", "demo")
    assert db.get("project") == "demo"
    assert db.path == tmp_path / "isolated.sqlite3"
    print("OK default_db_uses_env_override")


def test_isolated_db_does_not_touch_default_cache(
    tmp_path: Path, monkeypatch
) -> None:
    """Confirma que rodar dois testes não escreve em `.cache/`."""
    monkeypatch.setenv("APP_SQLITE_PATH", str(tmp_path / "isolated.sqlite3"))
    db = make_default_db()
    db.set("k", "v")
    default_cache = Path.cwd() / ".cache" / "app_state.sqlite3"
    assert not default_cache.exists(), (
        f"singleton tocou cache default: {default_cache}"
    )
    print("OK isolated_db_does_not_touch_default_cache")


# monkeypatch é mock simples para o protótipo:
class _MonkeyPatch:
    def __init__(self) -> None:
        self._saved: dict[str, str | None] = {}

    def setenv(self, k: str, v: str) -> None:
        self._saved.setdefault(k, os.environ.get(k))
        os.environ[k] = v

    def unset(self, k: str) -> None:
        if k in os.environ:
            del os.environ[k]

    def undo(self) -> None:
        for k, v in self._saved.items():
            if v is None:
                self.unset(k)
            else:
                os.environ[k] = v


def main() -> int:
    tests = [test_default_db_uses_env_override, test_isolated_db_does_not_touch_default_cache]
    failures = 0
    for t in tests:
        mp = _MonkeyPatch()
        tmp = Path(tempfile.mkdtemp(prefix="cue-studio-prototype-"))
        try:
            t(tmp, mp)
        except AssertionError as e:
            failures += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR {t.__name__}: {e}")
        finally:
            mp.undo()
    print(f"\n{len(tests)} tests run; failures={failures}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())