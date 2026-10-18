"""Builders compartilhados para os testes do Shot IR (A25).

Módulo auxiliar (não é coletado como teste). Os módulos de teste do Shot IR
importam estes builders para não duplicar a construção do IR de referência.
"""
from __future__ import annotations

from app.services.director.shot_ir_schema import (
    Action,
    AudioCue,
    Camera,
    CharacterInShot,
    ContinuityHints,
    Environment,
    Gaze,
    HandState,
    ObjectState,
    Position,
    ShotIR,
)


def make_character(
    char_id: str = "char_ana", **overrides
) -> CharacterInShot:
    """Personagem base — Ana à screen-left olhando para o João."""
    data = dict(
        id=char_id,
        position=Position(0.3, 0.5, 0.0, "screen_left"),
        gaze=Gaze("screen_right", target="char_joao"),
        hands=HandState(left="obj_cup", right=None),
        wardrobe_version="wardrobe_v2",
        expression="neutral",
        posture="standing",
    )
    data.update(overrides)
    return CharacterInShot(**data)


def make_joao(**overrides) -> CharacterInShot:
    """Segundo personagem base — João à screen-right olhando para a Ana."""
    data = dict(
        id="char_joao",
        position=Position(0.7, 0.5, 0.0, "screen_right"),
        gaze=Gaze("screen_left", target="char_ana"),
        hands=HandState(left=None, right=None),
        wardrobe_version="wardrobe_v1",
        expression="smiling",
        posture="standing",
    )
    data.update(overrides)
    return CharacterInShot(**data)


def make_shot(shot_id: str = "shot_001", **overrides) -> ShotIR:
    data = dict(
        shot_id=shot_id,
        characters=[make_character(), make_joao()],
        environment=Environment(
            location_id="loc_kitchen",
            time_of_day="morning",
            lighting="natural_window_left",
            objects_state=[ObjectState("obj_fridge", "closed")],
        ),
        action=Action(completed_in_shot=[], in_progress=[], next_intent=None),
        camera=Camera(shot_size="medium", movement="static", angle="eye_level"),
        audio=AudioCue(dialogue=None),
        continuity_hints=ContinuityHints(previous_shot_id=None),
    )
    data.update(overrides)
    return ShotIR(**data)
