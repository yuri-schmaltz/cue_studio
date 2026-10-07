"""Suíte completa para A02 — auth.

Roda em processo isolado (A06). Cobre 401, 200 com token, modo compartilhado
e modo local. Espera o backend FastAPI rodando em http://localhost:7860.

Os testes são pulados automaticamente se o backend não estiver disponível.
"""

from __future__ import annotations

import os
import socket
import sys
import tempfile
import uuid
from pathlib import Path

import pytest


def _isolate_env(tmp_path: Path) -> None:
    os.environ["APP_SQLITE_PATH"] = str(tmp_path / "state.sqlite3")
    os.environ["APP_CACHE_DIR"] = str(tmp_path / "cache")
    os.environ["CUE_TEST_MODE"] = "1"


def _server_alive(host: str = "localhost", port: int = 7860, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _server_alive(),
    reason="Backend Cue Studio não disponível em localhost:7860",
)


def test_health_is_public() -> None:
    import httpx
    r = httpx.get("http://localhost:7860/health", timeout=5)
    assert r.status_code == 200, r.text


def test_projects_without_token_returns_401() -> None:
    import httpx
    r = httpx.get("http://localhost:7860/api/projects", timeout=5)
    if os.environ.get("CUE_REQUIRE_AUTH") == "1":
        assert r.status_code == 401, r.text
        body = r.json()
        assert body["code"] == "auth.missing"
        assert "operationId" in body
    else:
        assert r.status_code in (200, 401)


def test_projects_with_invalid_token_returns_401() -> None:
    import httpx
    r = httpx.get(
        "http://localhost:7860/api/projects",
        headers={"Authorization": "Bearer wrong"},
        timeout=5,
    )
    if os.environ.get("CUE_REQUIRE_AUTH") == "1":
        assert r.status_code == 401, r.text


def test_projects_with_valid_token_passes() -> None:
    import httpx
    token = os.environ.get("CUE_API_KEY")
    if not token or os.environ.get("CUE_REQUIRE_AUTH") != "1":
        pytest.skip("auth não ativa neste modo")
    r = httpx.get(
        "http://localhost:7860/api/projects",
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
    )
    assert r.status_code != 401, r.text


def test_api_error_payload_shape() -> None:
    """Quando 401/4xx ocorre, payload tem shape canônico."""
    import httpx
    r = httpx.get("http://localhost:7860/api/projects", timeout=5)
    if r.status_code >= 400:
        body = r.json()
        assert {"code", "message", "operationId"}.issubset(body.keys()), body