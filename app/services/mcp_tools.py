"""MCP tool registry for Cue Studio.

Each tool wraps an existing service call so that MCP clients (Cursor, Cline,
Claude Code, custom scripts) can drive the studio through the same code paths
the UI buttons use.

Tools are intentionally **stateless** and **read-only by default**. Mutations
must be opted into by passing ``mutation=True`` in the tool spec — the dispatcher
refuses unknown mutations and surfaces a clear error.

This module has zero dependencies on FastAPI / Pydantic; the router (added in a
later PR) adapts HTTP/JSON envelopes into tool calls.
"""

from __future__ import annotations

import asyncio
import inspect
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping


# --------------------------------------------------------------------- errors


class McpToolError(ValueError):
    """Raised by a tool when the arguments are invalid or the call fails.

    The dispatcher converts this into a JSON-RPC ``-32602`` (invalid params)
    envelope with the message intact.
    """


# --------------------------------------------------------------------- tool spec


@dataclass(frozen=True)
class ToolSpec:
    """Static description of an MCP tool.

    ``handler`` accepts an arguments dict and returns either a JSON-serializable
    value or a coroutine that does. ``mutation=True`` means the tool changes
    server state (start/cancel pipeline, install LoRA, etc.); the dispatcher
    refuses to expose a mutation unless the caller is authenticated AND has
    not been read-only-restricted at the router level.
    """

    name: str
    description: str
    input_schema: Mapping[str, Any]
    handler: Callable[[Mapping[str, Any]], Any]
    mutation: bool = False
    required_capability: str | None = None
    annotations: Mapping[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------- registry


class ToolRegistry:
    """In-memory tool catalog. Thread-safe via the GIL + immutable ToolSpec."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"Tool already registered: {spec.name}")
        if not isinstance(spec.input_schema, Mapping):
            raise ValueError(f"Tool {spec.name}: input_schema must be a mapping")
        self._tools[spec.name] = spec

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)

    def get(self, name: str) -> ToolSpec:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise McpToolError(f"Unknown tool: {name}") from exc

    def has(self, name: str) -> bool:
        return name in self._tools

    def list_specs(self) -> list[dict[str, Any]]:
        """Return JSON-RPC-shaped tool descriptors for ``tools/list``."""
        out: list[dict[str, Any]] = []
        for spec in self._tools.values():
            entry: dict[str, Any] = {
                "name": spec.name,
                "description": spec.description,
                "inputSchema": dict(spec.input_schema),
            }
            if spec.annotations:
                entry["annotations"] = dict(spec.annotations)
            else:
                entry["annotations"] = {
                    "readOnlyHint": not spec.mutation,
                    "destructiveHint": False,
                    "idempotentHint": True,
                }
            out.append(entry)
        return out

    def __len__(self) -> int:
        return len(self._tools)


# --------------------------------------------------------------- default tools


def build_default_registry() -> ToolRegistry:
    """Build the registry with the initial curated tool set.

    Tools are intentionally read-mostly for v2.2.0. Mutations (start, cancel)
    come in a follow-up PR once we add capability gating and a request journal.
    """
    from . import mcp_tools_impl  # local import: avoid heavy deps at import time

    registry = ToolRegistry()

    # system_capabilities — read-only, baseline
    registry.register(
        ToolSpec(
            name="system_capabilities",
            description=(
                "Return the active runtime configuration: app version, "
                "transformer quantization, attention mode, codec, VRAM safety. "
                "Useful as a first call from an agent to confirm the server is "
                "responsive and to learn what hardware profile is in effect."
            ),
            input_schema={
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
            handler=mcp_tools_impl.system_capabilities,
        )
    )

    # llm_test_connection — read-only, smoke
    registry.register(
        ToolSpec(
            name="llm_test_connection",
            description=(
                "Probe the configured LLM endpoint (local llama-server or "
                "remote provider). Returns provider, model, status and a short "
                "preview when reachable. Use this before requesting prompts."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "timeout": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 120,
                        "description": "Seconds to wait for the probe (default 8).",
                    },
                },
                "additionalProperties": False,
            },
            handler=mcp_tools_impl.llm_test_connection,
        )
    )

    # llm_status — read-only
    registry.register(
        ToolSpec(
            name="llm_status",
            description=(
                "Return the active LLM model, role routing state, and any "
                "tracked active requests. Helps an agent pause before "
                "requesting heavy generation."
            ),
            input_schema={"type": "object", "properties": {}, "additionalProperties": False},
            handler=mcp_tools_impl.llm_status,
        )
    )

    # director_list_pipelines — read-only
    registry.register(
        ToolSpec(
            name="director_list_pipelines",
            description=(
                "List Director pipelines with their current stage, status, "
                "and last update. Filter by status (running/completed/failed/"
                "cancelled). Returns at most ``limit`` entries."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["running", "completed", "failed", "cancelled", "all"],
                        "description": "Filter by pipeline status (default 'all').",
                    },
                    "limit": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 200,
                        "description": "Maximum entries to return (default 50).",
                    },
                },
                "additionalProperties": False,
            },
            handler=mcp_tools_impl.director_list_pipelines,
        )
    )

    # director_get_pipeline — read-only
    registry.register(
        ToolSpec(
            name="director_get_pipeline",
            description=(
                "Fetch one Director pipeline by id, including its stage list "
                "and any error context. Use this to inspect a failed pipeline "
                "before deciding whether to retry or cancel."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "pipeline_id": {"type": "string", "minLength": 1},
                },
                "required": ["pipeline_id"],
                "additionalProperties": False,
            },
            handler=mcp_tools_impl.director_get_pipeline,
        )
    )

    return registry


# --------------------------------------------------------------- singleton


_default_registry: ToolRegistry | None = None


def get_default_registry() -> ToolRegistry:
    """Return the lazily-initialized default tool registry."""
    global _default_registry
    if _default_registry is None:
        _default_registry = build_default_registry()
    return _default_registry


def reset_default_registry_for_tests() -> None:
    global _default_registry
    _default_registry = None


# --------------------------------------------------------------- invocation


async def invoke_tool(
    registry: ToolRegistry,
    name: str,
    arguments: Mapping[str, Any],
) -> Any:
    """Dispatch one tool call. Validates required fields then awaits the handler.

    Returns the handler's JSON-serializable value. Raises ``McpToolError`` on
    validation failures; other exceptions are propagated (the dispatcher will
    convert them to JSON-RPC internal-error envelopes).
    """
    spec = registry.get(name)
    _validate_required(spec, arguments)
    value = spec.handler(arguments)
    if inspect.isawaitable(value):
        value = await value
    return value


def _validate_required(spec: ToolSpec, arguments: Mapping[str, Any]) -> None:
    """Validate ``required`` keys + reject unknown keys against the schema.

    Does NOT do full JSON-schema validation — that would require pulling in a
    validator. We do the minimal check that catches the most common agent
    mistakes: missing required and unknown properties.
    """
    if not isinstance(arguments, Mapping):
        raise McpToolError(f"Tool {spec.name}: arguments must be an object")
    schema = spec.input_schema
    properties = schema.get("properties", {})
    required = schema.get("required", []) or []
    additional = schema.get("additionalProperties", True)
    if additional is False:
        unknown = set(arguments) - set(properties)
        if unknown:
            raise McpToolError(
                f"Tool {spec.name}: unknown arguments: {sorted(unknown)}"
            )
    for key in required:
        if key not in arguments or arguments[key] in (None, ""):
            raise McpToolError(f"Tool {spec.name}: missing required argument '{key}'")
    for key, value in arguments.items():
        if key not in properties:
            continue
        prop = properties[key]
        if "type" not in prop:
            continue
        expected = prop["type"]
        if not _type_matches(value, expected):
            raise McpToolError(
                f"Tool {spec.name}: argument '{key}' must be of type '{expected}'"
            )


def _type_matches(value: Any, expected: str) -> bool:
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, Mapping)
    if expected == "null":
        return value is None
    return True  # unknown type → don't reject
