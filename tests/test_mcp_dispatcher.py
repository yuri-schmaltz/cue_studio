"""Tests for the MCP JSON-RPC dispatcher + tool registry."""

from __future__ import annotations

import inspect

import pytest

# Mark async tests individually with @pytest.mark.asyncio to keep sync tests
# warning-free. ``pytestmark`` is intentionally NOT used here.

from app.services.mcp_dispatcher import (
    PROTOCOL_VERSION,
    SERVER_NAME,
    SERVER_VERSION,
    make_dispatch,
)
from app.services.mcp_tools import (
    McpToolError,
    ToolRegistry,
    ToolSpec,
    invoke_tool,
)


# -------------------------------------------------------------- helpers


@pytest.fixture
def registry() -> ToolRegistry:
    reg = ToolRegistry()

    def echo(arguments):
        return {"echo": dict(arguments)}

    reg.register(
        ToolSpec(
            name="echo",
            description="Echo the arguments back.",
            input_schema={
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
                "additionalProperties": False,
            },
            handler=echo,
        )
    )

    def fail(arguments):
        raise McpToolError("intentional failure")

    reg.register(
        ToolSpec(
            name="fail",
            description="Always fails with McpToolError.",
            input_schema={"type": "object", "properties": {}, "additionalProperties": False},
            handler=fail,
        )
    )

    async def aecho(arguments):
        return {"aecho": dict(arguments)}

    reg.register(
        ToolSpec(
            name="aecho",
            description="Async echo.",
            input_schema={"type": "object", "properties": {}, "additionalProperties": False},
            handler=aecho,
        )
    )

    return reg


@pytest.fixture
def dispatch(registry):
    return make_dispatch(registry)


# ----------------------------------------------------------- envelope shape


@pytest.mark.asyncio
async def test_initialize_returns_capabilities(dispatch) -> None:
    result = await dispatch({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert result.http_status == 200
    payload = result.payload
    assert payload["jsonrpc"] == "2.0"
    assert payload["id"] == 1
    assert payload["result"]["protocolVersion"] == PROTOCOL_VERSION
    assert payload["result"]["serverInfo"]["name"] == SERVER_NAME
    assert payload["result"]["serverInfo"]["version"] == SERVER_VERSION
    assert "tools" in payload["result"]["capabilities"]


@pytest.mark.asyncio
async def test_ping_returns_empty_object(dispatch) -> None:
    result = await dispatch({"jsonrpc": "2.0", "id": 2, "method": "ping"})
    assert result.payload["result"] == {}


@pytest.mark.asyncio
async def test_unknown_method_returns_minus_32601(dispatch) -> None:
    result = await dispatch({"jsonrpc": "2.0", "id": 3, "method": "tools/wat"})
    assert result.payload["error"]["code"] == -32601
    assert "tools/wat" in result.payload["error"]["message"]


@pytest.mark.asyncio
async def test_invalid_request_envelope(dispatch) -> None:
    result = await dispatch({"id": 1, "method": "ping"})  # no jsonrpc
    assert result.payload["error"]["code"] == -32600


@pytest.mark.asyncio
async def test_non_object_envelope(dispatch) -> None:
    result = await dispatch("nonsense")
    assert result.payload["error"]["code"] == -32600


# ------------------------------------------------------------ notifications


@pytest.mark.asyncio
async def test_notification_returns_none(dispatch) -> None:
    result = await dispatch({"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert result.payload is None
    assert result.http_status == 202


@pytest.mark.asyncio
async def test_unknown_notification_silently_dropped(dispatch) -> None:
    result = await dispatch({"jsonrpc": "2.0", "method": "notifications/something_else"})
    assert result.payload is None


# ---------------------------------------------------------------- tools/list


@pytest.mark.asyncio
async def test_tools_list(dispatch) -> None:
    result = await dispatch({"jsonrpc": "2.0", "id": 4, "method": "tools/list"})
    tools = result.payload["result"]["tools"]
    names = {t["name"] for t in tools}
    assert {"echo", "fail", "aecho"}.issubset(names)
    for tool in tools:
        assert "inputSchema" in tool
        assert "annotations" in tool
        assert tool["annotations"]["readOnlyHint"] is True
        assert tool["annotations"]["destructiveHint"] is False


# -------------------------------------------------------------- tools/call


@pytest.mark.asyncio
async def test_tools_call_returns_content_envelope(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": {"name": "echo", "arguments": {"text": "hi"}},
    })
    content = result.payload["result"]["content"]
    assert result.payload["result"]["isError"] is False
    assert content[0]["type"] == "text"
    assert '"echo"' in content[0]["text"]
    assert '"text": "hi"' in content[0]["text"]


@pytest.mark.asyncio
async def test_tools_call_async_handler(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": {"name": "aecho", "arguments": {}},
    })
    text = result.payload["result"]["content"][0]["text"]
    assert '"aecho"' in text


@pytest.mark.asyncio
async def test_tools_call_missing_name(dispatch) -> None:
    result = await dispatch({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {}})
    # Missing name → McpToolError → returns isError=true (NOT a -32602 envelope
    # since McpToolError is a soft user error, not a transport error).
    assert result.payload["result"]["isError"] is True
    assert "name" in result.payload["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_tools_call_unknown_tool(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "tools/call",
        "params": {"name": "nope", "arguments": {}},
    })
    assert result.payload["result"]["isError"] is True
    assert "nope" in result.payload["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_tools_call_handler_error_is_content_envelope(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "tools/call",
        "params": {"name": "fail", "arguments": {}},
    })
    assert result.payload["result"]["isError"] is True
    assert "intentional failure" in result.payload["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_tools_call_validates_required_arguments(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 10,
        "method": "tools/call",
        "params": {"name": "echo", "arguments": {}},
    })
    assert result.payload["result"]["isError"] is True
    assert "text" in result.payload["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_tools_call_rejects_unknown_arguments(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 11,
        "method": "tools/call",
        "params": {"name": "echo", "arguments": {"text": "x", "extra": True}},
    })
    assert result.payload["result"]["isError"] is True
    assert "extra" in result.payload["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_tools_call_rejects_type_mismatch(dispatch) -> None:
    result = await dispatch({
        "jsonrpc": "2.0",
        "id": 12,
        "method": "tools/call",
        "params": {"name": "echo", "arguments": {"text": 123}},
    })
    assert result.payload["result"]["isError"] is True
    assert "string" in result.payload["result"]["content"][0]["text"]


# --------------------------------------------------------------- batch mode


@pytest.mark.asyncio
async def test_batch_of_notifications_returns_202(dispatch) -> None:
    result = await dispatch([
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"id": "x"}},
    ])
    assert result.payload is None
    assert result.http_status == 202


@pytest.mark.asyncio
async def test_batch_mixed(dispatch) -> None:
    result = await dispatch([
        {"jsonrpc": "2.0", "id": "a", "method": "ping"},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": "b", "method": "tools/call",
         "params": {"name": "echo", "arguments": {"text": "ok"}}},
    ])
    assert isinstance(result.payload, list)
    assert len(result.payload) == 2
    assert result.payload[0]["id"] == "a"
    assert result.payload[1]["id"] == "b"


@pytest.mark.asyncio
async def test_batch_too_large_rejected(dispatch) -> None:
    huge = [{"jsonrpc": "2.0", "id": i, "method": "ping"} for i in range(33)]
    result = await dispatch(huge)
    assert result.payload["error"]["code"] == -32600


@pytest.mark.asyncio
async def test_batch_empty_rejected(dispatch) -> None:
    result = await dispatch([])
    assert result.payload["error"]["code"] == -32600


# ------------------------------------------------------------- registry unit


def test_registry_rejects_duplicate() -> None:
    reg = ToolRegistry()
    spec = ToolSpec(name="x", description="", input_schema={}, handler=lambda a: None)
    reg.register(spec)
    with pytest.raises(ValueError):
        reg.register(spec)


def test_registry_rejects_bad_schema() -> None:
    reg = ToolRegistry()
    with pytest.raises(ValueError):
        reg.register(ToolSpec(name="x", description="", input_schema="not a mapping", handler=lambda a: None))


def test_registry_unknown_tool_raises() -> None:
    reg = ToolRegistry()
    with pytest.raises(McpToolError):
        reg.get("missing")


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_invoke_tool_returns_value() -> None:
    reg = ToolRegistry()
    reg.register(ToolSpec(name="t", description="", input_schema={"type": "object"}, handler=lambda a: 42))
    assert await invoke_tool(reg, "t", {}) == 42
