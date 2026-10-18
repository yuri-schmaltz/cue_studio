"""A25 — persistência atômica do sidecar Shot IR (``shot_ir_store``)."""
from __future__ import annotations

import json
import warnings

import pytest

from app.services.director.shot_ir_store import (
    ShotIRStore,
    list_shot_ir_ids,
    load_shot_ir,
    save_shot_ir_atomic,
    shots_dir_for,
)
from shot_ir_helpers import make_shot


def test_atomic_round_trip(tmp_path):
    path = tmp_path / "shots" / "shot_007.shot_ir.json"
    shot = make_shot("shot_007")
    saved = save_shot_ir_atomic(shot, path)
    assert saved == path and path.is_file()
    loaded = load_shot_ir(path)
    assert loaded.shot_id == "shot_007"
    assert loaded.environment.location_id == "loc_kitchen"
    assert len(loaded.characters) == 2


def test_save_does_not_leave_temp_files(tmp_path):
    path = tmp_path / "shot.shot_ir.json"
    save_shot_ir_atomic(make_shot("shot_001"), path)
    leftovers = [p for p in tmp_path.iterdir() if p.suffix == ".tmp"]
    assert leftovers == []


def test_save_rejects_invalid_shot(tmp_path):
    from app.services.director.shot_ir_schema import ShotIRValidationError

    shot = make_shot("shot_001")
    shot.camera = shot.camera.__class__("huge", "static", "eye_level")
    with pytest.raises(ShotIRValidationError):
        save_shot_ir_atomic(shot, tmp_path / "bad.shot_ir.json")
    assert not (tmp_path / "bad.shot_ir.json").exists()


def test_unknown_schema_version_warns_but_loads(tmp_path):
    path = tmp_path / "legacy.shot_ir.json"
    save_shot_ir_atomic(make_shot("legacy"), path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["schema_version"] = "2.0"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        loaded = load_shot_ir(path)
    assert loaded.shot_id == "legacy"
    assert any("schema_version" in str(w.message) for w in caught)


def test_corrupted_json_raises_validation_error(tmp_path):
    from app.services.director.shot_ir_schema import ShotIRValidationError

    path = tmp_path / "broken.shot_ir.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(ShotIRValidationError):
        load_shot_ir(path)


def test_store_round_trip_and_optional(tmp_path):
    store = ShotIRStore(tmp_path / "director" / "prod-1" / "shots")
    assert store.load_optional("shot_001") is None
    store.save(make_shot("shot_001"))
    assert store.exists("shot_001")
    loaded = store.load("shot_001")
    assert loaded.shot_id == "shot_001"
    assert store.delete("shot_001") is True
    assert store.delete("shot_001") is False


def test_store_lists_shots_in_stable_order(tmp_path):
    store = ShotIRStore(tmp_path)
    store.save(make_shot("shot_010"))
    store.save(make_shot("shot_002"))
    store.save(make_shot("shot_001"))
    assert list_shot_ir_ids(tmp_path) == ["shot_001", "shot_002", "shot_010"]
    assert [s.shot_id for s in store.list_shots()] == [
        "shot_001", "shot_002", "shot_010",
    ]


def test_store_skips_corrupted_sidecars(tmp_path):
    store = ShotIRStore(tmp_path)
    store.save(make_shot("shot_001"))
    (tmp_path / "shot_002.shot_ir.json").write_text("nope", encoding="utf-8")
    shots = store.list_shots()
    assert [s.shot_id for s in shots] == ["shot_001"]


def test_shots_dir_for_layout(tmp_path):
    directory = shots_dir_for(tmp_path, "prod-9")
    assert directory == tmp_path / "director" / "prod-9" / "shots"
