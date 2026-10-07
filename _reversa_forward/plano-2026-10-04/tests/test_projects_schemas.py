"""Testes para os schemas Pydantic (A10, A11, A14)."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))

from pydantic import ValidationError  # noqa: E402

from projects import (  # noqa: E402
    ProjectCreate,
    ProjectSummary,
    Project,
    SceneCard,
    DashboardSummary,
    QueueItem,
)


def test_project_create_validation() -> None:
    p = ProjectCreate(name="MV", type="music-video")
    assert p.preset_id is None
    with pytest_raises(ValidationError):
        ProjectCreate(name="", type="music-video")  # min_length
    with pytest_raises(ValidationError):
        ProjectCreate(name="x", type="invalid")  # enum


def test_project_round_trip() -> None:
    p = Project(
        id="abc",
        name="MV",
        type="music-video",
        updated_at=datetime(2026, 10, 4, 12, 0, 0),
        scenes=[
            SceneCard(id="s1", index=1, duration_sec=6, takes=1, status="done", prompt="ok"),
        ],
    )
    dumped = p.model_dump_json()
    parsed = Project.model_validate_json(dumped)
    assert parsed.id == "abc"
    assert parsed.scenes[0].status == "done"


def test_queue_item_progress_bounds() -> None:
    q = QueueItem(
        id="j", project_id="p", label="cena 1", state="running",
        progress=0.5, expected_sec=240, updated_at=datetime.now(),
    )
    assert q.progress == 0.5
    with pytest_raises(ValidationError):
        QueueItem(
            id="j", project_id="p", label="cena 1", state="running",
            progress=1.5, updated_at=datetime.now(),
        )


def test_dashboard_summary_empty() -> None:
    d = DashboardSummary()
    assert d.queue == []
    assert d.recent_outputs == []


# Helper at test fixture
def pytest_raises(exc_type):
    import pytest
    return pytest.raises(exc_type)