"""Testes de integração do Continuity Panel (A28)."""

from __future__ import annotations

import csv
import io
import json
import tempfile
from pathlib import Path

from app.services.continuity_panel import (
    ContinuityPanel,
    PanelEntry,
    SceneContinuitySummary,
    apply_overrides,
    export_csv,
    load_overrides,
    panel_for_production,
    render_html,
    save_overrides,
)


def test_panel_for_production_empty():
    panel = panel_for_production("prod-1", {})
    assert panel.production_id == "prod-1"
    assert panel.scenes == []
    assert panel.entries == []
    assert panel.totals() == {"info": 0, "warning": 0, "error": 0}
    assert not panel.has_any_error()


def test_panel_for_production_with_shots():
    # Sem check_sequence disponível (A25 não integrado), shots são passados
    # mas nenhuma inconsistência é detectada (check_sequence retorna [])
    panel = panel_for_production("prod-2", {"scene_1": []})
    assert len(panel.scenes) == 1
    assert panel.scenes[0].scene_id == "scene_1"


def test_totals_aggregation():
    panel = ContinuityPanel(production_id="prod-3")
    scene = SceneContinuitySummary(scene_id="s1", info_count=2, warning_count=1, error_count=0, total_count=3)
    panel.scenes.append(scene)
    assert panel.totals() == {"info": 2, "warning": 1, "error": 0}


def test_has_any_error():
    panel = ContinuityPanel(production_id="prod-4")
    scene = SceneContinuitySummary(scene_id="s1", error_count=1, total_count=1)
    panel.scenes.append(scene)
    assert panel.has_any_error() is True


def test_export_csv_empty():
    panel = ContinuityPanel(production_id="prod-5")
    csv_str = export_csv(panel)
    assert "scene_id" in csv_str
    assert "entry_id" in csv_str


def test_export_csv_with_entries():
    panel = ContinuityPanel(production_id="prod-6")
    entry = PanelEntry(
        inconsistency_id="abc123",
        kind="gaze_flip",
        severity="error",
        shot_id_a="S01",
        shot_id_b="S02",
        message="gaze flip detected",
        scene_id="scene_1",
    )
    panel.entries.append(entry)
    panel.scenes.append(SceneContinuitySummary(scene_id="scene_1", entries=[entry], error_count=1, total_count=1))
    csv_str = export_csv(panel)
    assert "gaze_flip" in csv_str
    assert "S01" in csv_str
    assert "S02" in csv_str


def test_render_html():
    panel = ContinuityPanel(production_id="prod-7")
    html = render_html(panel, title="Test Panel")
    assert "<html>" in html
    assert "Test Panel" in html
    assert "<table>" in html


def test_render_html_with_error_banner():
    panel = ContinuityPanel(production_id="prod-8")
    scene = SceneContinuitySummary(scene_id="s1", error_count=1, total_count=1)
    panel.scenes.append(scene)
    html = render_html(panel)
    assert 'role="alert"' in html


def test_apply_overrides():
    entry = PanelEntry(
        inconsistency_id="id1",
        kind="gaze_flip",
        severity="error",
        shot_id_a="S01",
        shot_id_b="S02",
        message="test",
    )
    overrides = {"id1": {"status": "justified", "note": "intencional"}}
    apply_overrides([entry], overrides)
    assert entry.status == "justified"
    assert entry.note == "intencional"


def test_save_load_overrides():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "overrides.json"
        entries = {"id1": {"status": "justified", "note": "test"}}
        save_overrides(path, entries)
        assert path.exists()
        loaded = load_overrides(path)
        assert loaded["id1"]["status"] == "justified"


def test_load_overrides_missing_file():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "nonexistent.json"
        loaded = load_overrides(path)
        assert loaded == {}


def test_entry_to_dict():
    entry = PanelEntry(
        inconsistency_id="id1",
        kind="gaze_flip",
        severity="warning",
        shot_id_a="S01",
        shot_id_b="S02",
        message="test",
    )
    d = entry.to_dict()
    assert d["kind"] == "gaze_flip"
    assert d["severity"] == "warning"


def test_scene_worst_severity():
    scene = SceneContinuitySummary(scene_id="s1", error_count=1, warning_count=2, info_count=3)
    assert scene.worst_severity == "error"

    scene2 = SceneContinuitySummary(scene_id="s2", warning_count=1)
    assert scene2.worst_severity == "warning"

    scene3 = SceneContinuitySummary(scene_id="s3")
    assert scene3.worst_severity == "none"
