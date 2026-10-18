"""A25 — detector de inconsistências de continuidade (``continuity_check``).

Cada uma das 6 regras tem teste isolado + uma sequência limpa (0 achados),
reproduzindo a suíte do protótipo autoritativo ``a25_shot_ir.py``.
"""
from __future__ import annotations

from app.services.director.continuity_check import (
    Severity,
    check_sequence,
    severity_counts,
)
from app.services.director.shot_ir_schema import (
    Gaze,
    HandState,
    ObjectState,
)
from shot_ir_helpers import make_joao, make_shot


def kinds(findings):
    return {f.kind for f in findings}


def test_clean_sequence_has_no_findings():
    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    s3 = make_shot("shot_003")
    findings = check_sequence([s1, s2, s3])
    assert findings == []


def test_single_shot_has_no_findings():
    assert check_sequence([make_shot("shot_001")]) == []


def test_empty_sequence_has_no_findings():
    assert check_sequence([]) == []


def test_gaze_flip_detected_as_warning():
    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    s2.characters[0].gaze = Gaze("screen_left", target="char_joao")
    findings = check_sequence([s1, s2])
    assert "gaze_flip" in kinds(findings)
    flip = next(f for f in findings if f.kind == "gaze_flip")
    assert flip.severity is Severity.WARNING
    assert flip.evidence["character_id"] == "char_ana"
    assert flip.evidence["from"] == "screen_right"
    assert flip.evidence["to"] == "screen_left"


def test_wardrobe_skip_detected_as_warning():
    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    s2.characters[0].wardrobe_version = "wardrobe_v9"
    findings = check_sequence([s1, s2])
    assert "wardrobe_skip" in kinds(findings)
    finding = next(f for f in findings if f.kind == "wardrobe_skip")
    assert finding.severity is Severity.WARNING


def test_object_hand_jump_detected_as_info():
    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    s2.characters[0].hands = HandState(left=None, right="obj_cup")
    findings = check_sequence([s1, s2])
    assert "object_hand_jump" in kinds(findings)
    finding = next(f for f in findings if f.kind == "object_hand_jump")
    assert finding.severity is Severity.INFO


def test_object_hand_jump_ignored_when_hands_unchanged():
    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    assert "object_hand_jump" not in kinds(check_sequence([s1, s2]))


def test_object_state_unsupported_detected_as_warning():
    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    s2.environment.objects_state = [ObjectState("obj_fridge", "open")]
    findings = check_sequence([s1, s2])
    assert "object_state_unsupported" in kinds(findings)
    finding = next(f for f in findings if f.kind == "object_state_unsupported")
    assert finding.severity is Severity.WARNING
    assert finding.evidence["from"] == "closed"
    assert finding.evidence["to"] == "open"


def test_object_state_change_allowed_when_action_mentions_it():
    # A regra é textual: aceita mudança quando a ação menciona o id ou o
    # novo estado do objeto.
    s1 = make_shot("shot_001")
    s1.action.in_progress = ["Ana abre a geladeira (obj_fridge)"]
    s2 = make_shot("shot_002")
    s2.environment.objects_state = [ObjectState("obj_fridge", "open")]
    assert "object_state_unsupported" not in kinds(check_sequence([s1, s2]))


def test_action_orphan_detected_as_warning():
    s1 = make_shot("shot_001")
    s1.action.in_progress = ["Ana serve o café"]
    s2 = make_shot("shot_002")
    findings = check_sequence([s1, s2])
    assert "action_orphan" in kinds(findings)
    finding = next(f for f in findings if f.kind == "action_orphan")
    assert finding.severity is Severity.WARNING
    assert finding.evidence["intent"] == "Ana serve o café"


def test_action_orphan_cleared_when_completed_next_shot():
    s1 = make_shot("shot_001")
    s1.action.in_progress = ["Ana serve o café"]
    s2 = make_shot("shot_002")
    s2.action.completed_in_shot = ["Ana serve o café"]
    assert "action_orphan" not in kinds(check_sequence([s1, s2]))


def test_position_collision_detected_as_error():
    shot = make_shot("shot_001")
    shot.characters[1].position = shot.characters[0].position.__class__(
        0.3, 0.5, 0.0, "screen_left"
    )
    findings = check_sequence([shot])
    assert "position_collision" in kinds(findings)
    finding = next(f for f in findings if f.kind == "position_collision")
    assert finding.severity is Severity.ERROR


def test_inconsistency_to_dict_is_json_serializable():
    import json

    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    s2.characters[0].gaze = Gaze("screen_left", target="char_joao")
    findings = check_sequence([s1, s2])
    payload = [f.to_dict() for f in findings]
    assert payload and json.loads(json.dumps(payload)) == payload
    assert all({"kind", "severity", "shot_id_a", "shot_id_b", "message",
                "evidence"} <= set(item) for item in payload)


def test_severity_counts_aggregates_by_level():
    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    s2.characters[0].gaze = Gaze("screen_left", target="char_joao")
    s2.characters[0].wardrobe_version = "wardrobe_v9"
    counts = severity_counts(check_sequence([s1, s2]))
    assert counts["warning"] >= 2
    assert sum(counts.values()) == sum(
        len(check_sequence([s1, s2])) for _ in [0]
    )


def test_character_missing_in_next_shot_is_skipped():
    s1 = make_shot("shot_001")
    s2 = make_shot("shot_002")
    s2.characters = [make_joao()]  # some apenas a Ana
    findings = check_sequence([s1, s2])
    # Sem Ana no plano seguinte, nenhuma regra por-personagem pode compará-la.
    assert "gaze_flip" not in kinds(findings)
    assert "wardrobe_skip" not in kinds(findings)
    assert "object_hand_jump" not in kinds(findings)
