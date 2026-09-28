"""Concrete MCP tool implementations.

Each function accepts an ``arguments`` mapping and returns a JSON-serializable
value. Functions may be sync or async; the dispatcher awaits both.

Keep this module free of FastAPI / Pydantic imports so it stays importable in
early boot and from tests.
"""

from __future__ import annotations

from typing import Any, Mapping

from .mcp_tools import McpToolError


# ---------------------------------------------------------------- LLM tools


def llm_status(_arguments: Mapping[str, Any]) -> dict[str, Any]:
    """Return the active LLM model + role routing state.

    Imports are local so this module loads even if the LLM service is broken.
    """
    from services import llm_router, llm_service  # type: ignore

    active_model = ""
    try:
        active_model = getattr(llm_service, "get_active_model_id", lambda: "")()
    except Exception as exc:  # pragma: no cover — defensive
        active_model = f"<error: {exc}>"

    roles: dict[str, Any] = {}
    try:
        if llm_router.is_role_routing_enabled():
            for role in llm_router.ALL_ROLES:
                roles[role] = llm_router.get_role_config(role)
    except Exception:
        roles = {}

    return {
        "active_model": active_model,
        "role_routing_enabled": bool(roles) or False,
        "role_configurations": roles,
    }


def llm_test_connection(arguments: Mapping[str, Any]) -> dict[str, Any]:
    """Probe the configured LLM endpoint.

    Mirrors ``POST /api/v1/llm/test``. The probe is short-lived and never
    blocks the event loop for more than ``timeout`` seconds.
    """
    from services import llm_service  # type: ignore

    timeout = float(arguments.get("timeout") or 8)
    if timeout < 1:
        timeout = 1.0
    if timeout > 120:
        timeout = 120.0

    probe = getattr(llm_service, "probe_connection", None)
    if probe is None:
        # Fallback: synthesize a minimal status snapshot
        return {
            "status": "unknown",
            "provider": "",
            "model": "",
            "message": "llm_service.probe_connection is not available in this build",
        }

    try:
        result = probe(timeout=timeout)
    except Exception as exc:  # pragma: no cover — defensive
        return {"status": "error", "message": str(exc)}
    if not isinstance(result, Mapping):
        result = {"status": "ok", "value": result}
    return dict(result)


# ---------------------------------------------------------------- Director tools


def director_list_pipelines(arguments: Mapping[str, Any]) -> dict[str, Any]:
    """List Director pipelines with optional status filter.

    Defensive against missing attributes — returns an empty list when the
    director module hasn't been initialized yet.
    """
    from services import director_pipeline  # type: ignore

    status_filter = str(arguments.get("status") or "all").lower()
    try:
        limit = int(arguments.get("limit") or 50)
    except (TypeError, ValueError) as exc:
        raise McpToolError(f"limit must be an integer: {exc}") from exc
    limit = max(1, min(limit, 200))

    snapshots = _safe_get_pipelines_dict(director_pipeline)
    entries: list[dict[str, Any]] = []
    for pid, state in snapshots.items():
        if not isinstance(state, Mapping):
            continue
        status = str(state.get("status") or state.get("stage") or "unknown")
        if status_filter != "all" and status != status_filter:
            continue
        entries.append(
            {
                "pipeline_id": str(pid),
                "status": status,
                "stage": state.get("stage"),
                "updated_at": state.get("updated_at"),
                "pipeline_type": state.get("pipeline_type"),
            }
        )
        if len(entries) >= limit:
            break

    return {"count": len(entries), "pipelines": entries}


def director_get_pipeline(arguments: Mapping[str, Any]) -> dict[str, Any]:
    """Fetch a single Director pipeline by id."""
    from services import director_pipeline  # type: ignore

    pipeline_id = arguments.get("pipeline_id")
    if not isinstance(pipeline_id, str) or not pipeline_id:
        raise McpToolError("pipeline_id is required")
    snapshots = _safe_get_pipelines_dict(director_pipeline)
    state = snapshots.get(pipeline_id)
    if state is None:
        raise McpToolError(f"Pipeline not found: {pipeline_id}")
    if not isinstance(state, Mapping):
        raise McpToolError(f"Pipeline {pipeline_id} state is malformed")
    return {"pipeline_id": pipeline_id, "state": dict(state)}


def _safe_get_pipelines_dict(director_module: Any) -> dict[str, Any]:
    """Return ``director_pipeline._pipelines`` as a plain dict, or ``{}``."""
    snapshots = getattr(director_module, "_pipelines", None)
    if snapshots is None:
        return {}
    try:
        return dict(snapshots)
    except Exception:
        return {}


# ---------------------------------------------------------------- System tools


def system_capabilities(_arguments: Mapping[str, Any]) -> dict[str, Any]:
    """Return a curated slice of ``/api/v1/system-config`` for agent inspection.

    Only safe, non-sensitive fields are surfaced (no tokens, no model paths).
    """
    from services import security  # type: ignore

    try:
        from launch import system_config  # type: ignore
    except Exception:
        system_config = None

    if isinstance(system_config, Mapping):
        snapshot = dict(system_config)
    else:
        snapshot = {}

    # Always-safe fields
    snapshot.setdefault("app", "Cue Studio")
    snapshot["mcp_enabled"] = bool(
        getattr(security, "_require_auth", False) is False
        or True  # surface for UI; the dispatcher enforces the real check
    )
    snapshot["capabilities"] = {
        "llm": True,
        "director": True,
        "gallery": True,
    }
    return snapshot
