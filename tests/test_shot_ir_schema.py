"""A25 — validação do schema Shot IR (``shot_ir_schema``)."""
from __future__ import annotations

import pytest

from app.services.director.shot_ir_schema import (
    Camera,
    ContinuityHints,
    Environment,
    Gaze,
    ObjectState,
    Position,
    ShotIRValidationError,
    dict_to_shotir,
    shotir_to_dict,
)
from shot_ir_helpers import make_shot


def test_valid_shot_ir_passes_validation():
    shot = make_shot()
    shot.validate()  # não deve levantar


def test_empty_shot_id_rejected():
    with pytest.raises(ShotIRValidationError):
        make_shot(shot_id="").validate()


def test_unknown_schema_version_rejected_by_validate():
    shot = make_shot()
    shot.schema_version = "2.0"
    with pytest.raises(ShotIRValidationError):
        shot.validate()


def test_position_out_of_range_rejected():
    with pytest.raises(ShotIRValidationError):
        Position(1.5, 0.5, 0.0, "screen_left").validate()


def test_position_z_out_of_range_rejected():
    with pytest.raises(ShotIRValidationError):
        Position(0.5, 0.5, 3.0, "screen_left").validate()


def test_invalid_frame_rejected():
    with pytest.raises(ShotIRValidationError):
        Position(0.5, 0.5, 0.0, "sideways").validate()


def test_invalid_gaze_direction_rejected():
    with pytest.raises(ShotIRValidationError):
        Gaze("diagonal_left").validate()


def test_invalid_time_of_day_rejected():
    with pytest.raises(ShotIRValidationError):
        Environment("loc_kitchen", "noon", "natural", []).validate()


def test_empty_location_rejected():
    with pytest.raises(ShotIRValidationError):
        Environment("", "morning", "natural", []).validate()


def test_invalid_camera_enums_rejected():
    with pytest.raises(ShotIRValidationError):
        Camera("huge", "static", "eye_level").validate()
    with pytest.raises(ShotIRValidationError):
        Camera("medium", "zoom", "eye_level").validate()
    with pytest.raises(ShotIRValidationError):
        Camera("medium", "static", "tilted").validate()


def test_object_state_accepts_free_form_strings():
    # object_state.state aceita string livre (risco mitigado da spec 7).
    shot = make_shot()
    shot.environment.objects_state = [ObjectState("obj_door", "half_open")]
    shot.validate()


def test_round_trip_dict_preserves_fields():
    shot = make_shot("shot_042")
    payload = shotir_to_dict(shot)
    restored = dict_to_shotir(payload)
    assert restored.shot_id == "shot_042"
    assert restored.schema_version == "1.0"
    assert [c.id for c in restored.characters] == ["char_ana", "char_joao"]
    assert restored.environment.location_id == "loc_kitchen"
    assert restored.environment.objects_state[0].state == "closed"
    assert restored.camera.shot_size == "medium"


def test_dict_to_shotir_requires_schema_version():
    payload = shotir_to_dict(make_shot())
    payload.pop("schema_version")
    with pytest.raises(ShotIRValidationError):
        dict_to_shotir(payload)


def test_dict_to_shotir_tolerates_future_version():
    """Versão futura é lida como legado (sem validação estrita)."""
    payload = shotir_to_dict(make_shot())
    payload["schema_version"] = "2.0"
    restored = dict_to_shotir(payload)
    assert restored.shot_id == "shot_001"
    assert restored.schema_version == "2.0"


def test_continuity_hints_optional_fields_default_none():
    hints = ContinuityHints()
    assert hints.previous_shot_id is None
    assert hints.state_inherited_from is None
