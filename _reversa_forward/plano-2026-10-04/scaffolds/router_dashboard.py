"""Scaffold do router Dashboard (A11)."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))

from fastapi import APIRouter, Query  # noqa: E402

from projects import (  # noqa: E402
    DashboardSummary,
    ContinueProject,
    QueueItem,
    RecentOutput,
)


def build_dashboard_router() -> APIRouter:
    r = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

    @r.get("/summary", response_model=DashboardSummary)
    def summary() -> DashboardSummary:
        now = datetime.now()
        # Stub: substituir por agregação real
        return DashboardSummary(
            continue_project=ContinueProject(
                id="abc",
                name="Lançamento Outono",
                section="briefing",
                updated_at=now,
            ),
            queue=[
                QueueItem(
                    id="j1",
                    project_id="abc",
                    label="Cena 3",
                    state="running",
                    progress=0.38,
                    expected_sec=240,
                    updated_at=now,
                ),
            ],
            recent_outputs=[
                RecentOutput(
                    id="o1",
                    project_id="abc",
                    thumb="/thumbs/o1.jpg",
                    created_at=now,
                ),
            ],
        )

    return r


if __name__ == "__main__":
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(build_dashboard_router())
    c = TestClient(app)
    r = c.get("/api/dashboard/summary")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["continueProject"]["id"] == "abc"
    assert body["queue"][0]["state"] == "running"
    print("OK scaffold/router_dashboard.py")