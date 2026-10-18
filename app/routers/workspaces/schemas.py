"""Pydantic types + validation for the workspaces (projects) domain (A16).

The HTTP handlers deliberately keep the pre-A16 parsing behaviour (raw
``await request.json()`` with explicit 400s), so the models here describe
the payloads and own the shared name validation that used to live as
inline ``re.match`` calls in ``launch.py``.
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field

WORKSPACE_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
INVALID_NAME_MESSAGE = (
    "Invalid workspace name. Use letters, numbers, hyphens, underscores."
)


def is_valid_workspace_name(name: str) -> bool:
    """True for ``default``-style workspace folder names."""
    return bool(WORKSPACE_NAME_PATTERN.match(name))


class WorkspaceActiveRequest(BaseModel):
    """PUT /api/v1/workspaces/active body."""

    name: str = "default"


class WorkspaceCreateRequest(BaseModel):
    """POST /api/v1/workspaces body."""

    name: str = ""


class WorkspaceSetupBody(BaseModel):
    """PUT /api/v1/workspaces/{name}/setup body.

    Accepts either the setup object directly or wrapped as
    ``{"setup": {...}}`` — the wrapper form is resolved by the handler
    before validation.
    """

    setup: dict = Field(default_factory=dict)


class WorkspaceCoverResponse(BaseModel):
    """Response shared by the cover upload/serve/delete endpoints."""

    status: str = "ok"
    name: str
    cover_image: str | None = None
    setup: dict = Field(default_factory=dict)


__all__ = [
    "INVALID_NAME_MESSAGE",
    "WORKSPACE_NAME_PATTERN",
    "WorkspaceActiveRequest",
    "WorkspaceCoverResponse",
    "WorkspaceCreateRequest",
    "WorkspaceSetupBody",
    "is_valid_workspace_name",
]
