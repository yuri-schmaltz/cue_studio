"""MCP server access control for Cue Studio.

Manages the Bearer token used by external MCP clients (Cursor, Cline, Claude
Code, custom agents) to authenticate against ``/api/v1/mcp``.

The token has three sources, in priority order:

1. ``CUE_MCP_TOKEN`` environment variable (deployment-managed, immutable from UI)
2. Persisted JSON file at ``<config_dir>/mcp.json``
3. Generated on first enable (returned once, never logged)

The module is intentionally dependency-free outside stdlib so it can be
imported during early boot, in tests, and from UI settings without pulling
in the FastAPI machinery.

Token format: 32+ chars from ``secrets.token_urlsafe(32)``. File writes are
atomic (tmp + fsync + os.replace) and mode 0o600 on POSIX.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
from pathlib import Path
from typing import Any


_MCP_FILE_NAME = "mcp.json"
_FILE_MODE = 0o600
_DIR_MODE = 0o700


class McpAccess:
    """Thread-safe MCP token store.

    Parameters
    ----------
    path:
        Where to persist ``{"enabled": bool, "token": str}``. Created on first
        write; parents are created with mode 0o700.
    env_token:
        Optional callable returning the current value of the env-managed token.
        Defaults to ``CUE_MCP_TOKEN``. When non-empty, the env token always
        wins and UI rotation is rejected.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        env_token: "Any | None" = None,
    ) -> None:
        self.path = Path(path)
        self._env_token_callable = env_token or (
            lambda: os.environ.get("CUE_MCP_TOKEN", "").strip()
        )
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ read

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        with self.path.open(encoding="utf-8") as handle:
            value = json.load(handle)
        if not isinstance(value, dict):
            raise ValueError("Invalid MCP access settings: not an object")
        enabled = value.get("enabled")
        token = value.get("token", "")
        if enabled is not None and not isinstance(enabled, bool):
            raise ValueError("Invalid MCP access settings: enabled must be bool")
        if not isinstance(token, str):
            raise ValueError("Invalid MCP access settings: token must be string")
        return {"enabled": bool(enabled) if enabled is not None else False,
                "token": token}

    def _env_token(self) -> str:
        try:
            value = self._env_token_callable()
        except Exception:
            return ""
        return str(value or "").strip()

    def is_env_managed(self) -> bool:
        """Return True when ``CUE_MCP_TOKEN`` is set (env wins)."""
        return bool(self._env_token())

    # --------------------------------------------------------------- public

    def token(self) -> str:
        """Return the active token (env-managed beats persisted beats empty)."""
        with self._lock:
            env = self._env_token()
            if env:
                return env
            config = self._read()
            if config.get("enabled") is False:
                return ""
            return config.get("token", "")

    def is_enabled(self) -> bool:
        """Whether the MCP server should accept authenticated calls.

        When env-managed, the service is always reachable (env wins).
        Otherwise, the persisted ``enabled`` flag is authoritative.
        """
        with self._lock:
            if self._env_token():
                return True
            config = self._read()
            return bool(config.get("enabled"))

    def persisted_enabled(self) -> bool | None:
        """Return the persisted ``enabled`` flag (``None`` if file absent).

        Distinct from :meth:`is_enabled` because env-management always
        enables the server. UI surfaces this so the user can see their
        own toggle state separately from the env override.
        """
        with self._lock:
            if not self.path.exists():
                return None
            config = self._read()
            return bool(config.get("enabled"))

    def status(self) -> dict[str, Any]:
        """Public status snapshot (token never included when issued earlier).

        ``enabled`` reflects the persisted user toggle. When the env token
        is set, ``managedByEnvironment`` is true and ``enabled`` shows what
        the user last wrote to disk — but the server is reachable regardless.
        Callers that need the effective state should OR with env presence.
        """
        with self._lock:
            env = self._env_token()
            persisted = self._read().get("enabled", False)
            return {
                "enabled": bool(persisted),
                "managedByEnvironment": bool(env),
                "endpoint": "/api/v1/mcp",
                "transport": "streamable-http",
                "authentication": "Bearer",
                "protocolVersion": "2025-03-26",
            }

    def update(self, enabled: bool, rotate: bool = False) -> dict[str, Any]:
        """Enable/disable the MCP server; optionally rotate the token.

        Raises ``PermissionError`` when the env token is set (caller must
        change the environment variable instead).

        Returns the status snapshot, including the new token iff it was
        generated during this call. Callers must surface it to the user
        exactly once — never log it.
        """
        with self._lock:
            env = self._env_token()
            if env:
                if rotate:
                    raise PermissionError(
                        "CUE_MCP_TOKEN is managed by the environment; "
                        "change it there."
                    )
                # Env-managed: persist enabled state for visibility but the
                # token field is irrelevant.
                config: dict[str, Any] = self._read()
                config["enabled"] = bool(enabled)
                config["token"] = ""  # never persist alongside env token
                self._write(config)
                return self.status()

            config = self._read()
            current_token = config.get("token", "")
            issued = bool(enabled) and (rotate or not current_token)
            if issued:
                current_token = secrets.token_urlsafe(32)
            config["enabled"] = bool(enabled)
            config["token"] = current_token
            self._write(config)
            snapshot = self.status()
            if issued:
                # Returned ONLY at issuance; never included in subsequent
                # status() calls and never written to logs.
                snapshot["token"] = current_token
            return snapshot

    # --------------------------------------------------------------- internals

    def _write(self, config: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.path.parent, _DIR_MODE)
        except (OSError, NotImplementedError):
            pass

        # Atomic write: tmp file in same dir, fsync, os.replace.
        suffix = secrets.token_hex(6)
        tmp = self.path.with_name(f".{self.path.name}.{suffix}.tmp")
        try:
            fd = os.open(
                str(tmp),
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                _FILE_MODE,
            )
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(config, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
            try:
                os.chmod(self.path, _FILE_MODE)
            except (OSError, NotImplementedError):
                pass
        finally:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass


# ------------------------------------------------------------ module-level singleton


_default: McpAccess | None = None
_default_lock = threading.RLock()


def get_default() -> McpAccess:
    """Return the lazily-initialized default ``McpAccess``.

    Path resolves to ``<CUE_CONFIG_DIR>/mcp.json`` where ``CUE_CONFIG_DIR``
    defaults to ``~/.cue_studio`` (matching the rest of the codebase).
    """
    global _default
    with _default_lock:
        if _default is not None:
            return _default
        config_dir = os.environ.get("CUE_CONFIG_DIR", "").strip() or os.path.join(
            os.path.expanduser("~"), ".cue_studio"
        )
        _default = McpAccess(os.path.join(config_dir, _MCP_FILE_NAME))
        return _default


def reset_default_for_tests(instance: McpAccess | None = None) -> None:
    """Test hook: replace (or clear) the module singleton."""
    global _default
    with _default_lock:
        _default = instance
