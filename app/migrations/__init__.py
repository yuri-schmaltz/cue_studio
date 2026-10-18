"""Versioned SQLite migrations for the app-state database (A18).

See ``runner.py`` for the idempotent runner and
``docs/persistence-matrix.md`` (repo: ``app/docs/persistence-matrix.md``)
for the entity → source-of-truth mapping.
"""
from __future__ import annotations

from pathlib import Path

from .runner import (
    MIGRATIONS_DIR,
    SCHEMA_VERSION,
    applied_versions,
    discover_migrations,
    migrate,
    status,
)

__all__ = [
    "MIGRATIONS_DIR",
    "SCHEMA_VERSION",
    "applied_versions",
    "discover_migrations",
    "migrate",
    "status",
]
