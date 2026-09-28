"""MCP JSON-RPC dispatcher for Cue Studio.

Implements the Model Context Protocol (protocolVersion 2025-03-26) over
streamable-HTTP. Only the request/response envelope is handled here — the
actual tool bodies live in :mod:`services.mcp_tools_impl` and are looked up
through a :class:`services.mcp_tools.ToolRegistry`.

Supported methods:

  - ``initialize``        → server info + capabilities
  - ``ping``              → liveness check (returns empty object)
  - ``tools/list``        → array of JSON-RPC tool descriptors
  - ``tools/call``        → invoke one tool, return ``content`` envelope

Anything else returns ``-32601 Method not found``.

Error model:

  - ``-32700`` Parse error  — body is not valid JSON
  - ``-32600`` Invalid request — body is not a JSON-RPC 2.0 object
  - ``-32601`` Method not found
  - ``-32602`` Invalid params — wrapped from ``McpToolError``
  - ``-32603`` Internal error — wrapped from any other exception

Notifications (requests without ``id``) return ``None`` (caller responds 202).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping, Sequence

from .mcp_tools import McpToolError, ToolRegistry, invoke_tool


PROTOCOL_VERSION = "2025-03-26"
SERVER_NAME = "cue-studio"
SERVER_VERSION = "2.2.0"


@dataclass(frozen=True)
class DispatchResult:
    """One JSON-RPC response envelope (or ``None`` for notifications)."""

    payload: dict[str, Any] | None
    http_status: int


# JSON-RPC standard error codes
_PARSE_ERROR = -32700
_INVALID_REQUEST = -32600
_METHOD_NOT_FOUND = -32601
_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


_logger = logging.getLogger("cue_studio.mcp")


def make_dispatch(
    registry: ToolRegistry,
    *,
    protocol_version: str = PROTOCOL_VERSION,
    server_name: str = SERVER_NAME,
    server_version: str = SERVER_VERSION,
) -> Callable[[Mapping[str, Any] | Sequence[Any] | None], Awaitable[DispatchResult]]:
    """Build an async dispatch callable bound to ``registry``.

    The returned coroutine accepts a single JSON-RPC payload (or a list of up
    to 32 payloads for batch requests) and returns a :class:`DispatchResult`
    describing the HTTP response.
    """

    async def dispatch(body: Mapping[str, Any] | Sequence[Any] | None) -> DispatchResult:
        if body is None:
            return DispatchResult(payload=None, http_status=202)

        if isinstance(body, list):
            if not 1 <= len(body) <= 32:
                return DispatchResult(
                    payload=_error(None, _INVALID_REQUEST, "Invalid batch size"),
                    http_status=400,
                )
            results: list[dict[str, Any]] = []
            for entry in body:
                result = await _dispatch_single(entry, registry, protocol_version, server_name, server_version)
                if result is not None:
                    results.append(result)
            if not results:
                return DispatchResult(payload=None, http_status=202)
            return DispatchResult(payload=results, http_status=200)

        result = await _dispatch_single(body, registry, protocol_version, server_name, server_version)
        if result is None:
            return DispatchResult(payload=None, http_status=202)
        return DispatchResult(payload=result, http_status=200)

    return dispatch


async def _dispatch_single(
    body: Any,
    registry: ToolRegistry,
    protocol_version: str,
    server_name: str,
    server_version: str,
) -> dict[str, Any] | None:
    if not isinstance(body, Mapping):
        return _error(None, _INVALID_REQUEST, "Invalid request")
    if body.get("jsonrpc") != "2.0":
        return _error(body.get("id"), _INVALID_REQUEST, "Invalid request")

    # Notification (no id) — server must not reply.
    if "id" not in body:
        method = body.get("method")
        if method in {"notifications/cancelled", "notifications/initialized"}:
            return None  # accepted, no response
        return None  # unknown notification — silently ignored

    request_id = body["id"]
    method = body.get("method")
    params = body.get("params") or {}

    try:
        if method == "initialize":
            result = _initialize_result(protocol_version, server_name, server_version)
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": registry.list_specs()}
        elif method == "tools/call":
            name = params.get("name")
            arguments = params.get("arguments") or {}
            if not isinstance(name, str) or not name:
                raise McpToolError("tools/call requires params.name")
            value = await invoke_tool(registry, name, arguments)
            result = {
                "content": [
                    {"type": "text", "text": _to_json_text(value)},
                ],
                "isError": False,
            }
        else:
            return _error(request_id, _METHOD_NOT_FOUND, f"Method not found: {method}")
    except McpToolError as exc:
        _logger.info("mcp tool error: %s", exc)
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "isError": True,
                "content": [{"type": "text", "text": str(exc)}],
            },
        }
    except Exception as exc:  # pragma: no cover — defensive
        _logger.exception("mcp internal error during %s", method)
        return _error(request_id, _INTERNAL_ERROR, f"Internal error: {exc}")

    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _initialize_result(protocol_version: str, server_name: str, server_version: str) -> dict[str, Any]:
    return {
        "protocolVersion": protocol_version,
        "capabilities": {"tools": {}},
        "serverInfo": {"name": server_name, "version": server_version},
        "instructions": (
            "Cue Studio MCP server. Tools are read-mostly in v2.2.0; mutations "
            "are added in a follow-up release. Use system_capabilities as the "
            "first call to confirm the server is responsive."
        ),
    }


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _to_json_text(value: Any) -> str:
    """Compact JSON serialization for the text content envelope."""
    import json

    return json.dumps(value, ensure_ascii=False, default=str)
