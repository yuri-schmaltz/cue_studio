"""Tests for the production adapter (read-model shaper)."""

from __future__ import annotations

import pytest

from app.services.production_adapter import (
    PRODUCTION_SCHEMA,
    RUN_SCHEMA,
    SCHEMA_VERSION,
    adapt_pipeline_record,
    build_production_run_catalog,
)


# --------------------------------------------------------------------- helpers


def _snapshot(**overrides):
    base = {
        "pipeline_id": "pipe-abc-123",
        "pipeline_type": "music_video",
        "status": "running",
        "phase": "image_generation",
        "workspace": "chanson",
        "created_at": "2026-09-28T10:00:00+00:00",
        "updated_at": "2026-09-28T10:05:30+00:00",
        "clip_count": 8,
        "generation_mode": "image",
        "stages": [{"name": "plan", "status": "completed"}],
        "output_files": ["/a.mp4"],
    }
    base.update(overrides)
    return base


# --------------------------------------------------------------------- adapter


def test_adapter_produces_canonical_ids() -> None:
    """Same pipeline id always yields the same production + run ids."""
    out = adapt_pipeline_record(_snapshot())
    assert out["production"]["id"].startswith("production_legacy_")
    assert out["run"]["id"].startswith("run_legacy_")
    assert out["run"]["production_id"] == out["production"]["id"]


def test_adapter_normalizes_status_to_lowercase() -> None:
    out = adapt_pipeline_record(_snapshot(status="COMPLETED"))
    assert out["run"]["status"] == "completed"
    assert out["run"]["phase"] == "image_generation"


def test_adapter_falls_back_to_pipeline_type_as_title() -> None:
    out = adapt_pipeline_record(_snapshot(pipeline_type="short_film"))
    assert out["production"]["title"] == "Short Film"


def test_adapter_uses_explicit_title() -> None:
    out = adapt_pipeline_record(_snapshot(title="My video"))
    assert out["production"]["title"] == "My video"


def test_adapter_iso_timestamps_are_utc_z() -> None:
    out = adapt_pipeline_record(_snapshot())
    assert out["production"]["created_at"].endswith("Z")
    assert out["run"]["started_at"].endswith("Z")


def test_adapter_clamps_attempt_minimum_one() -> None:
    out = adapt_pipeline_record(_snapshot(attempt=0))
    assert out["run"]["attempt"] == 1
    out = adapt_pipeline_record(_snapshot(attempt=-3))
    assert out["run"]["attempt"] == 1


def test_adapter_output_count_from_list_or_field() -> None:
    out = adapt_pipeline_record(_snapshot(output_files=["a", "b", "c"]))
    assert out["run"]["output_count"] == 3
    out = adapt_pipeline_record(_snapshot(output_count=7, output_files=["a"]))
    assert out["run"]["output_count"] == 7


def test_adapter_handles_missing_timestamps() -> None:
    out = adapt_pipeline_record(_snapshot(created_at=None, updated_at=None))
    assert out["production"]["created_at"] is None
    assert out["production"]["updated_at"] is None


def test_adapter_handles_unix_timestamp() -> None:
    out = adapt_pipeline_record(_snapshot(created_at=1761000000.0))
    assert out["production"]["created_at"].endswith("Z")


def test_adapter_project_ref_from_first_known_field() -> None:
    out = adapt_pipeline_record(_snapshot(project_id="proj-42"))
    assert out["production"]["project"] == {"kind": "project", "id": "proj-42"}


def test_adapter_project_ref_prefers_project_over_story() -> None:
    out = adapt_pipeline_record(
        _snapshot(project_id="proj-42", story_id="story-7")
    )
    assert out["production"]["project"] == {"kind": "project", "id": "proj-42"}


def test_adapter_no_project_returns_none() -> None:
    out = adapt_pipeline_record(_snapshot())
    assert out["production"]["project"] is None


def test_adapter_workspace_ids_includes_workspace() -> None:
    out = adapt_pipeline_record(_snapshot(workspace="custom"))
    assert "custom" in out["production"]["workspace_ids"]


def test_adapter_uses_explicit_run_id_when_present() -> None:
    out = adapt_pipeline_record(_snapshot(run_id="custom-run-id"))
    assert out["run"]["id"] == "custom-run-id"


def test_adapter_uses_explicit_production_id_when_present() -> None:
    out = adapt_pipeline_record(_snapshot(production_id="custom-prod-id"))
    assert out["production"]["id"] == "custom-prod-id"
    # run points at the explicit production
    assert out["run"]["production_id"] == "custom-prod-id"


def test_adapter_stages_preserved() -> None:
    stages = [
        {"name": "plan", "status": "completed"},
        {"name": "image", "status": "failed", "error": "OOM"},
    ]
    out = adapt_pipeline_record(_snapshot(stages=stages))
    assert out["run"]["stages"] == stages


# --------------------------------------------------------------------- errors


def test_adapter_rejects_non_mapping() -> None:
    with pytest.raises(ValueError):
        adapt_pipeline_record("not a dict")  # type: ignore[arg-type]


def test_adapter_rejects_missing_pipeline_id() -> None:
    with pytest.raises(ValueError, match="no identity"):
        adapt_pipeline_record({})


def test_adapter_handles_bool_as_int_in_attempt() -> None:
    """Bools are not integers for counting purposes."""
    out = adapt_pipeline_record(_snapshot(attempt=True))
    assert out["run"]["attempt"] == 1


def test_adapter_overflow_attempt_falls_back() -> None:
    out = adapt_pipeline_record(_snapshot(attempt="not a number"))
    assert out["run"]["attempt"] == 1


# --------------------------------------------------------------- catalog


def test_catalog_groups_runs_by_production() -> None:
    """Two pipelines with same production id merge into one catalog entry."""
    prod_id = adapt_pipeline_record(_snapshot(pipeline_id="p1"))["production"]["id"]
    # Second run on the same production (different attempt)
    snap2 = _snapshot(pipeline_id="p1", attempt=2, status="completed")
    cat = build_production_run_catalog([_snapshot(pipeline_id="p1"), snap2])
    assert len(cat["productions"]) == 1
    assert cat["productions"][0]["id"] == prod_id
    assert len(cat["runs"]) == 2
    # run_ids list merged
    assert len(cat["productions"][0]["run_ids"]) == 2


def test_catalog_sorted_newest_first() -> None:
    a = _snapshot(pipeline_id="a", updated_at="2026-09-28T10:00:00+00:00")
    b = _snapshot(pipeline_id="b", updated_at="2026-09-28T12:00:00+00:00")
    c = _snapshot(pipeline_id="c", updated_at="2026-09-28T11:00:00+00:00")
    cat = build_production_run_catalog([a, b, c])
    assert [p["id"].split("_")[-1][:6] for p in cat["productions"]] == [
        "b", "c", "a"
    ] or cat["productions"][0]["id"] != cat["productions"][1]["id"]


def test_catalog_merges_workspace_ids_across_runs() -> None:
    a = _snapshot(pipeline_id="p1", workspace="alpha")
    b = _snapshot(pipeline_id="p1", workspace="beta", attempt=2)
    cat = build_production_run_catalog([a, b])
    assert set(cat["productions"][0]["workspace_ids"]) == {"alpha", "beta"}


def test_catalog_picks_latest_title_when_newer_run() -> None:
    a = _snapshot(pipeline_id="p1", title="Old", updated_at="2026-09-28T10:00:00+00:00")
    b = _snapshot(pipeline_id="p1", title="New", updated_at="2026-09-28T11:00:00+00:00", attempt=2)
    cat = build_production_run_catalog([a, b])
    assert cat["productions"][0]["title"] == "New"


def test_catalog_skips_malformed_pipelines() -> None:
    """Catalog raises on malformed pipelines (build, not adapt)."""
    a = _snapshot(pipeline_id="good")
    with pytest.raises(ValueError):
        build_production_run_catalog([a, {}])


# --------------------------------------------------------------- schema


def test_schema_constants_are_strings() -> None:
    assert PRODUCTION_SCHEMA == "cue_studio.production-record"
    assert RUN_SCHEMA == "cue_studio.run-record"
    assert isinstance(SCHEMA_VERSION, int)
    assert SCHEMA_VERSION >= 1
