"""Tests for the FastAPI MCP router (/api/v1/mcp)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.mcp_access import McpAccess, reset_default_for_tests
from app.routers.mcp import build_mcp_router


# pytestmark removed; markers added per-test instead


@pytest.fixture
def mcp_dir(tmp_path: Path) -> Path:
    d = tmp_path / "cue"
    d.mkdir()
    return d


@pytest.fixture
def mcp_access(mcp_dir: Path) -> McpAccess:
    inst = McpAccess(mcp_dir / "mcp.json")
    reset_default_for_tests(inst)
    return inst


@pytest.fixture
def app(mcp_access: McpAccess) -> FastAPI:
    """Build a minimal FastAPI app with the MCP router mounted."""
    application = FastAPI()
    application.include_router(build_mcp_router())
    return application


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def token(mcp_access: McpAccess) -> str:
    result = mcp_access.update(enabled=True)
    return result["token"]


# ------------------------------------------------------------------- disabled


def test_post_returns_503_when_disabled(client: TestClient) -> None:
    """Without a token the endpoint refuses with 503, not 401."""
    response = client.post("/api/v1/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert response.status_code == 503
    assert "disabled" in response.json()["detail"].lower()


def test_get_returns_405_with_allow_header(client: TestClient) -> None:
    response = client.get("/api/v1/mcp")
    assert response.status_code == 405
    assert response.headers.get("Allow") == "POST"


# ----------------------------------------------------------------- auth happy


def test_post_with_valid_token_returns_ping(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
    )
    assert response.status_code == 200
    assert response.json() == {"jsonrpc": "2.0", "id": 1, "result": {}}


def test_post_with_invalid_token_returns_401(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        headers={"Authorization": "Bearer not-the-real-token"},
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
    )
    assert response.status_code == 401
    assert response.headers.get("WWW-Authenticate") == "Bearer"


def test_post_without_auth_header_returns_401(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
    )
    assert response.status_code == 401


# ----------------------------------------------------------- content negotiation


def test_rejects_non_json_content_type(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/plain",
        },
        content="not json",
    )
    assert response.status_code == 415


# ----------------------------------------------------------------- parse errors


def test_malformed_json_returns_minus_32700(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        content="{not json",
    )
    assert response.status_code == 400
    body = response.json()
    assert body["jsonrpc"] == "2.0"
    assert body["error"]["code"] == -32700


# --------------------------------------------------------------- end-to-end


def test_initialize_via_http(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "id": "i", "method": "initialize", "params": {}},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["result"]["serverInfo"]["name"] == "cue-studio"
    assert payload["result"]["capabilities"]["tools"] == {}


def test_tools_list_via_http(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "id": "l", "method": "tools/list"},
    )
    assert response.status_code == 200
    tools = response.json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert {"system_capabilities", "llm_status", "director_list_pipelines"}.issubset(names)


def test_tools_call_via_http_returns_content(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "jsonrpc": "2.0",
            "id": "c",
            "method": "tools/call",
            "params": {"name": "director_list_pipelines", "arguments": {"limit": 10}},
        },
    )
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["isError"] is False
    content = json.loads(result["content"][0]["text"])
    assert "pipelines" in content


def test_notification_returns_202(client: TestClient, token: str) -> None:
    response = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    assert response.status_code == 202
    assert response.content == b""


# -------------------------------------------------------------- env-managed


def test_env_managed_token_works(client: TestClient, monkeypatch) -> None:
    """When CUE_MCP_TOKEN is set, the env value authenticates immediately."""
    env_value = "env-token-must-be-at-least-32-chars-long-x"
    monkeypatch.setenv("CUE_MCP_TOKEN", env_value)
    # No file written, no update() call — env alone is enough.
    response = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {env_value}"},
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
    )
    assert response.status_code == 200
    assert response.json()["result"] == {}


def test_env_managed_rejects_other_token(client: TestClient, monkeypatch) -> None:
    env_value = "env-token-must-be-at-least-32-chars-long-x"
    monkeypatch.setenv("CUE_MCP_TOKEN", env_value)
    response = client.post(
        "/api/v1/mcp",
        headers={"Authorization": "Bearer something-else-32-chars-long-xxxxxxxx"},
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
    )
    assert response.status_code == 401
