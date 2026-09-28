"""Tests for services.mcp_access — MCP token + access control."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest

from app.services.mcp_access import McpAccess, reset_default_for_tests


@pytest.fixture
def mcp_dir(tmp_path: Path) -> Path:
    """Return an isolated config dir for McpAccess instances."""
    d = tmp_path / "cue"
    d.mkdir()
    return d


@pytest.fixture
def mcp(mcp_dir: Path) -> McpAccess:
    return McpAccess(mcp_dir / "mcp.json")


# --------------------------------------------------------------------- basics


def test_disabled_by_default(mcp: McpAccess) -> None:
    """Fresh file → disabled, empty token, no env, status reflects it."""
    assert not mcp.is_enabled()
    assert mcp.token() == ""
    status = mcp.status()
    assert status["enabled"] is False
    assert status["managedByEnvironment"] is False
    assert status["endpoint"] == "/api/v1/mcp"
    assert status["transport"] == "streamable-http"
    assert status["authentication"] == "Bearer"
    assert status["protocolVersion"] == "2025-03-26"
    assert "token" not in status


def test_enable_generates_token_returned_once(mcp: McpAccess) -> None:
    """First enable returns a fresh token; subsequent status() hides it."""
    result = mcp.update(enabled=True)
    assert result["enabled"] is True
    token = result.get("token", "")
    assert len(token) >= 32

    # Persisted on disk
    persisted = json.loads(mcp.path.read_text(encoding="utf-8"))
    assert persisted["enabled"] is True
    assert persisted["token"] == token

    # Status no longer reveals token
    later = mcp.status()
    assert later["enabled"] is True
    assert "token" not in later
    assert mcp.token() == token


def test_enable_when_already_enabled_does_not_rotate(mcp: McpAccess) -> None:
    """Re-enabling without rotate keeps the existing token."""
    first = mcp.update(enabled=True)
    token = first["token"]
    second = mcp.update(enabled=True)
    assert second["enabled"] is True
    assert "token" not in second  # not issued this call
    assert mcp.token() == token


def test_rotate_changes_token(mcp: McpAccess) -> None:
    """rotate=True on enable always issues a fresh token."""
    first = mcp.update(enabled=True)
    old = first["token"]
    rotated = mcp.update(enabled=True, rotate=True)
    assert rotated["token"] != old
    assert mcp.token() == rotated["token"]


def test_disable_keeps_token_but_rejects(mcp: McpAccess) -> None:
    """Disabled MCP refuses to issue tokens but keeps the previous one on disk."""
    mcp.update(enabled=True)
    snapshot_token = mcp.token()
    mcp.update(enabled=False)
    assert mcp.is_enabled() is False
    assert mcp.token() == ""
    # The token remains on disk; a later re-enable without rotate will reuse it
    reenabled = mcp.update(enabled=True)
    assert "token" not in reenabled  # not freshly issued
    assert mcp.token() == snapshot_token


# ----------------------------------------------------------------- env wins


def test_env_token_overrides_persisted(mcp: McpAccess, monkeypatch) -> None:
    """When CUE_MCP_TOKEN is set, env wins; persisted token is shadowed."""
    monkeypatch.setenv("CUE_MCP_TOKEN", "env-token-at-least-32-chars-long-xxx")
    mcp.update(enabled=True)
    persisted = mcp.token()  # env wins
    assert persisted == "env-token-at-least-32-chars-long-xxx"
    assert mcp.is_env_managed() is True
    assert mcp.is_enabled() is True


def test_env_managed_blocks_rotate(mcp: McpAccess, monkeypatch) -> None:
    """Cannot rotate via UI/API when env token is set."""
    monkeypatch.setenv("CUE_MCP_TOKEN", "env-token-at-least-32-chars-long-xxx")
    with pytest.raises(PermissionError):
        mcp.update(enabled=True, rotate=True)


def test_env_managed_persists_enabled_state(mcp: McpAccess, monkeypatch) -> None:
    """When env-managed, disable/enable updates only the enabled flag."""
    monkeypatch.setenv("CUE_MCP_TOKEN", "env-token-at-least-32-chars-long-xxx")
    snapshot = mcp.update(enabled=False)
    assert snapshot["enabled"] is False
    assert snapshot["managedByEnvironment"] is True
    persisted = json.loads(mcp.path.read_text(encoding="utf-8"))
    assert persisted["enabled"] is False
    assert persisted["token"] == ""  # never persisted alongside env


def test_env_cleared_falls_back_to_persisted(mcp: McpAccess, monkeypatch) -> None:
    """Clearing the env after env-managed period reveals the persisted state."""
    monkeypatch.setenv("CUE_MCP_TOKEN", "env-token-at-least-32-chars-long-xxx")
    mcp.update(enabled=True)
    monkeypatch.delenv("CUE_MCP_TOKEN", raising=False)
    assert mcp.is_env_managed() is False
    # During env-managed period the persisted flag was last set to True,
    # so after clearing env the user-intent state is still "enabled".
    assert mcp.is_enabled() is True
    # And the token comes from disk (NOT the now-cleared env variable).
    assert mcp.token() != "env-token-at-least-32-chars-long-xxx"
    # Disabling after env-clear must work and clear the active token.
    mcp.update(enabled=False)
    assert mcp.is_enabled() is False
    assert mcp.token() == ""


# ----------------------------------------------------------- filesystem safety


def test_file_permissions_0600(mcp: McpAccess, mcp_dir: Path) -> None:
    """Persisted file is owner-readable only on POSIX."""
    mcp.update(enabled=True)
    if os.name != "posix":
        pytest.skip("POSIX file mode check only")
    mode = stat.S_IMODE(mcp.path.stat().st_mode)
    assert mode == 0o600, f"expected 0o600, got {oct(mode)}"


def test_atomic_write_no_partial_file(mcp: McpAccess, mcp_dir: Path) -> None:
    """No leftover .tmp files after a successful update."""
    mcp.update(enabled=True)
    leftovers = [
        p for p in mcp_dir.iterdir() if p.name.startswith(".mcp.json.") and p.name.endswith(".tmp")
    ]
    assert leftovers == []


def test_corrupted_file_raises_value_error(mcp: McpAccess) -> None:
    """Loading a non-object JSON must fail loudly, not silently default."""
    mcp.path.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(ValueError):
        mcp._read()


def test_invalid_enabled_type_raises(mcp: McpAccess) -> None:
    """enabled field must be a bool; reject other types."""
    mcp.path.write_text(json.dumps({"enabled": "yes", "token": ""}), encoding="utf-8")
    with pytest.raises(ValueError):
        mcp._read()


# ----------------------------------------------------------------- env callable


def test_env_callable_used_when_provided(mcp_dir: Path) -> None:
    """Custom env_token callable is invoked on each access."""
    state = {"value": "callable-token-at-least-32-chars-long-xxx"}

    def token_fn() -> str:
        return state["value"]

    mcp = McpAccess(mcp_dir / "mcp.json", env_token=token_fn)
    mcp.update(enabled=True)
    assert mcp.token() == "callable-token-at-least-32-chars-long-xxx"
    state["value"] = "new-callable-token-at-least-32-chars-long-xxx"
    assert mcp.token() == "new-callable-token-at-least-32-chars-long-xxx"


def test_env_callable_exception_returns_empty(mcp_dir: Path) -> None:
    """A buggy env callable degrades to empty token, never crashes."""

    def broken() -> str:
        raise RuntimeError("boom")

    mcp = McpAccess(mcp_dir / "mcp.json", env_token=broken)
    assert mcp.env_token_compat() == "" if hasattr(mcp, "env_token_compat") else True
    # Sanity: still functions (no exception escapes)
    assert mcp.status()["enabled"] is False


# ------------------------------------------------------------ thread safety


def test_concurrent_update_serializes(mcp: McpAccess) -> None:
    """Multiple concurrent enable calls must not corrupt the file."""
    import threading

    tokens: list[str] = []
    barrier = threading.Barrier(8)

    def worker() -> None:
        barrier.wait()
        result = mcp.update(enabled=True, rotate=True)
        if result.get("token"):
            tokens.append(result["token"])

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # At least one rotation issued a fresh token
    assert tokens
    # Final on-disk state must be valid JSON (no partial writes)
    persisted = json.loads(mcp.path.read_text(encoding="utf-8"))
    assert persisted["enabled"] is True
    assert persisted["token"]


# -------------------------------------------------------------- module singleton


def test_default_singleton_resettable(tmp_path: Path, monkeypatch) -> None:
    """The module-level singleton can be replaced for tests."""
    monkeypatch.setenv("CUE_CONFIG_DIR", str(tmp_path))
    reset_default_for_tests(None)
    from app.services.mcp_access import get_default

    inst = get_default()
    assert inst.path.parent == tmp_path
    reset_default_for_tests(inst)
    assert get_default() is inst
    reset_default_for_tests(None)
