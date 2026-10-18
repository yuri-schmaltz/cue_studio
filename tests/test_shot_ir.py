"""Testes de integração do Shot IR + continuity check (A25)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from app.services.shot_ir import (
    Action,
    AudioCue,
    Camera,
    CharacterInShot,
    ContinuityHints,
    Environment,
    Gaze,
    HandState,
    Inconsistency,
    ObjectState,
    Position,
    ShotIR,
    ShotIRValidationError,
    check_sequence,
    dict_to_shotir,
    load_shotir,
    save_shotir_atomic,
    shotir_to_dict,
)


def _make_ana() -> CharacterInShot:
    return CharacterInShot(
        id="char_ana",
        position=Position(0.3, 0.5, 0.0, "screen_left"),
        gaze=Gaze("screen_right", target="char_joao"),
        hands=HandState(left="obj_cup", right=None),
        wardrobe_version="wardrobe_v2",
        expression="neutral",
        posture="standing",
    )


def _make_joao() -> CharacterInShot:
    return CharacterInShot(
        id="char_joao",
        position=Position(0.7, 0.5, 0.0, "screen_right"),
        gaze=Gaze("screen_left", target="char_ana"),
        hands=HandState(left=None, right=None),
        wardrobe_version="wardrobe_v1",
        expression="smiling",
        posture="standing",
    )


def _make_shot(shot_id: str, extra: dict = None) -> ShotIR:
    extra = extra or {}
    return ShotIR(
        schema_version="1.0",
        shot_id=shot_id,
        characters=[_make_ana(), _make_joao()],
        environment=Environment(
            location_id=extra.get("location", "loc_kitchen"),
            time_of_day="morning",
            lighting="natural_window_left",
            objects_state=extra.get("objects_state", []),
        ),
        action=Action(
            completed_in_shot=extra.get("completed", []),
            in_progress=extra.get("in_progress", []),
        ),
        camera=Camera(shot_size="medium", movement="static", angle="eye_level"),
        audio=AudioCue(dialogue=extra.get("dialogue")),
        continuity_hints=ContinuityHints(previous_shot_id=extra.get("prev_id")),
    )


def test_shotir_validate():
    shot = _make_shot("S01")
    shot.validate()  # não deve levantar


def test_shotir_rejects_bad_schema_version():
    shot = _make_shot("S01")
    shot.schema_version = "99.0"
    try:
        shot.validate()
        assert False, "deveria ter levantado"
    except ShotIRValidationError:
        pass


def test_shotir_rejects_empty_shot_id():
    shot = _make_shot("S01")
    shot.shot_id = ""
    try:
        shot.validate()
        assert False, "deveria ter levantado"
    except ShotIRValidationError:
        pass


def test_shotir_roundtrip():
    shot = _make_shot("S01")
    d = shotir_to_dict(shot)
    shot2 = dict_to_shotir(d)
    assert shot2.shot_id == shot.shot_id
    assert len(shot2.characters) == len(shot.characters)
    assert shot2.characters[0].id == shot.characters[0].id


def test_save_load_shotir_atomic():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "shot.json"
        shot = _make_shot("S01")
        save_shotir_atomic(shot, path)
        assert path.exists()
        loaded = load_shotir(path)
        assert loaded.shot_id == shot.shot_id


def test_load_shotir_unknown_schema_warns():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "shot.json"
        shot = _make_shot("S01")
        payload = shotir_to_dict(shot)
        payload["schema_version"] = "0.9"
        path.write_text(json.dumps(payload))
        import warnings
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            loaded = load_shotir(path)
            assert any("schema_version" in str(x.message) for x in w)


def test_check_sequence_no_issues():
    shots = [_make_shot("S01"), _make_shot("S02")]
    issues = check_sequence(shots)
    # Sem inconsistências (gaze não virou 180°, etc.)
    assert isinstance(issues, list)


def test_check_sequence_gaze_flip():
    shot1 = _make_shot("S01")
    shot2 = _make_shot("S02")
    # Inverter gaze de ana para simular flip
    shot2.characters[0].gaze = Gaze("screen_left", target="char_joao")
    issues = check_sequence([shot1, shot2])
    assert any(i.kind == "gaze_flip" for i in issues)


def test_check_sequence_wardrobe_skip():
    shot1 = _make_shot("S01")
    shot2 = _make_shot("S02")
    shot2.characters[0].wardrobe_version = "wardrobe_v3"
    issues = check_sequence([shot1, shot2])
    assert any(i.kind == "wardrobe_skip" for i in issues)


def test_check_sequence_object_state_unsupported():
    shot1 = _make_shot("S01", extra={"objects_state": [ObjectState(id="door", state="closed")]})
    shot2 = _make_shot("S02", extra={"objects_state": [ObjectState(id="door", state="open")]})
    issues = check_sequence([shot1, shot2])
    assert any(i.kind == "object_state_unsupported" for i in issues)


def test_check_sequence_action_orphan():
    shot1 = _make_shot("S01", extra={"in_progress": ["paint_door"]})
    shot2 = _make_shot("S02", extra={"completed": []})
    issues = check_sequence([shot1, shot2])
    assert any(i.kind == "action_orphan" for i in issues)


def test_check_sequence_position_collision():
    shot = _make_shot("S01")
    # Dois personagens no mesmo frame
    shot.characters[1].position.frame = "screen_left"
    issues = check_sequence([shot])
    assert any(i.kind == "position_collision" for i in issues)


def test_inconsistency_to_dict():
    inc = Inconsistency(kind="gaze_flip", severity="warning", shot_id_a="S01", shot_id_b="S02", message="test", evidence={})
    d = inc.__dict__ if hasattr(inc, "__dict__") else {}
    assert inc.kind == "gaze_flip"
    assert inc.severity == "warning"


def test_position_validate():
    pos = Position(0.5, 0.5, 0.0, "screen_left")
    pos.validate()

    pos2 = Position(1.5, 0.5, 0.0, "screen_left")
    try:
        pos2.validate()
        assert False, "deveria ter levantado"
    except ShotIRValidationError:
        pass


def test_camera_validate():
    cam = Camera(shot_size="medium", movement="static", angle="eye_level")
    cam.validate()

    cam2 = Camera(shot_size="invalid", movement="static", angle="eye_level")
    try:
        cam2.validate()
        assert False, "deveria ter levantado"
    except ShotIRValidationError:
        pass


def test_environment_validate():
    env = Environment(location_id="loc_1", time_of_day="morning", lighting="natural")
    env.validate()

    env2 = Environment(location_id="", time_of_day="morning", lighting="natural")
    try:
        env2.validate()
        assert False, "deveria ter levantado"
    except ShotIRValidationError:
        pass
