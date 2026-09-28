"""FastAPI router exposing Cue Studio over MCP (Model Context Protocol).

Wires :mod:`services.mcp_access` (token + status) and
:mod:`services.mcp_dispatcher` (JSON-RPC envelope) into a single
``/api/v1/mcp`` endpoint that accepts POST requests.

The router is intentionally tiny — it does three things:

1. Authenticate the Bearer token (503 when MCP is disabled, 401 otherwise)
2. Parse the JSON body (return -32700 on bad JSON)
3. Delegate to the dispatcher built from the default tool registry

GET on the same path returns 405 with ``Allow: POST`` (streamable-HTTP is
POST-only; the GET handler exists only to signal that).
"""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any, Awaitable, Callable, Mapping, Sequence

from fastapi import APIRouter, HTTPException, Request, Response

from app.services.mcp_access import get_default as get_default_access
from app.services.mcp_dispatcher import make_dispatch
from app.services.mcp_tools import get_default_registry


_logger = logging.getLogger("cue_studio.mcp.router")


def _build_router() -> APIRouter:
    """Construct the router. Token + dispatcher are looked up on each request
    so tests can swap the default :class:`McpAccess` instance via
    ``reset_default_for_tests``."""
    router = APIRouter()

    @router.post("/api/v1/mcp", include_in_schema=False)
    async def mcp_post(request: Request) -> Response:
        access = get_default_access()
        token = access.token()
        if not token:
            raise HTTPException(
                status_code=503,
                detail="External agent access is disabled; configure CUE_MCP_TOKEN or enable MCP in Settings.",
            )

        auth_header = request.headers.get("authorization", "")
        if not secrets.compare_digest(auth_header, f"Bearer {token}"):
            raise HTTPException(
                status_code=401,
                detail="Invalid MCP credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Defence-in-depth: origin header must match the request URL.
        origin = request.headers.get("origin")
        if origin:
            expected = f"{request.url.scheme}://{request.url.netloc}"
            if origin != expected:
                raise HTTPException(status_code=403, detail="Origin is not permitted")

        # Optional JSON-RPC frame guard: reject text/plain from bots that
        # try to scrape the endpoint as a normal page.
        content_type = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if content_type and content_type not in ("application/json", "application/json-rpc", ""):
            raise HTTPException(status_code=415, detail=f"Unsupported Media Type: {content_type}")

        try:
            body = await request.json()
        except ValueError:
            return _json_response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": "Parse error"},
                },
                status_code=400,
            )

        if not _is_valid_body_shape(body):
            return _json_response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32600, "message": "Invalid request"},
                },
                status_code=400,
            )

        dispatch = make_dispatch(get_default_registry())
        result = await dispatch(body)
        if result.payload is None:
            return Response(status_code=202)
        return _json_response(result.payload, status_code=result.http_status)

    @router.get("/api/v1/mcp", include_in_schema=False)
    async def mcp_get() -> Response:
        return Response(status_code=405, headers={"Allow": "POST"})

    return router


def _is_valid_body_shape(body: Any) -> bool:
    """Light envelope check — the dispatcher does the full validation."""
    if body is None:
        return True  # notification batch
    if isinstance(body, list):
        return all(_is_valid_body_shape(entry) for entry in body)
    if isinstance(body, Mapping):
        # Accept the JSON-RPC envelope OR a legacy "method+params" body that
        # some early agents send. The dispatcher will reject anything else.
        return True
    return False


def _json_response(payload: Mapping[str, Any] | Sequence[Any], *, status_code: int) -> Response:
    body = json.dumps(payload, ensure_ascii=False, default=str)
    return Response(
        content=body,
        status_code=status_code,
        media_type="application/json",
    )


def build_mcp_router() -> APIRouter:
    """Public factory: returns a router ready for ``api.include_router(...)``."""
    return _build_router()
