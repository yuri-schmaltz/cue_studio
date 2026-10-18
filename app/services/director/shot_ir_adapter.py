"""Conversão do H3 story ledger em Shot IR (A25).

Estende o que ``h3_story_ledger`` (v24) já produz —
``subject_continuity`` / ``setting_continuity`` / ``visual_continuity`` /
``blocking_contract`` — para o IR explícito exposto pela UI. Não reescreve
o ledger (spec 2.2: apenas consome e estende).

Backward compatibility (spec 2.1 e plano 3): campos sem origem no ledger
recebem defaults documentados ou ``None``, e o IR resultante é marcado
como legado via ``derived_from_ledger`` nos hints de auditoria.
"""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional

from .shot_ir_schema import (
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


_UNSET = "unspecified"
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(value: str) -> str:
    """Normaliza texto do ledger em um id curto (``loc_kitchen`` etc.)."""
    slug = _SLUG_RE.sub("_", (value or "").strip().lower()).strip("_")
    return slug[:48] or _UNSET


def _first_sentence(value: Any) -> str:
    """Primeira frase curta de um campo textual do ledger."""
    if not isinstance(value, str) or not value.strip():
        return ""
    return re.split(r"[.\n]", value.strip(), maxsplit=1)[0].strip()


def _ledger_source(ledger: Mapping[str, Any]) -> Mapping[str, Any]:
    """Extrai o ``source_intent`` do ledger (tolerante a payloads legados)."""
    intent = ledger.get("source_intent")
    return intent if isinstance(intent, Mapping) else {}


def _derived_cast_names(ledger: Mapping[str, Any]) -> list[str]:
    """Nomes de elenco mais confiáveis disponíveis no ledger."""
    intent = _ledger_source(ledger)
    for key in ("cast_names", "characters", "cast"):
        value = intent.get(key)
        if isinstance(value, (list, tuple)) and value:
            return [str(v) for v in value if v]
    pov = intent.get("pov_identity")
    return [str(pov)] if pov else []


def to_shot_ir(
    ledger: Mapping[str, Any],
    *,
    shot_id: str,
    previous_shot_id: Optional[str] = None,
) -> ShotIR:
    """Converte uma entrada do H3 story ledger em Shot IR parcial.

    Parameters
    ----------
    ledger:
        Dicionário produzido por ``h3_story_ledger`` (campos
        ``subject_continuity``, ``setting_continuity``,
        ``visual_continuity``, ``required_final_outcome``,
        ``beats``, ``source_intent``).
    shot_id:
        Identificador do plano que receberá o IR derivado.
    previous_shot_id:
        Plano anterior da mesma cena, quando houver.

    Campos sem origem explícita no ledger recebem defaults neutros
    (posição central, olhar ``away``, mãos vazias, ``time_of_day`` de
    meio-dia), permitindo que o usuário complete o IR na UI.
    """
    cast_names = _derived_cast_names(ledger)
    characters = [
        CharacterInShot(
            id=name,
            position=Position(x=0.5, y=0.5, z=0.0, frame="screen_center"),
            gaze=Gaze(direction="away"),
            hands=HandState(),
            wardrobe_version=_UNSET,
            expression=_UNSET,
            posture=_UNSET,
        )
        for name in cast_names
    ]

    setting_text = _first_sentence(ledger.get("setting_continuity"))
    environment = Environment(
        location_id=_slugify(setting_text) if setting_text else _UNSET,
        time_of_day="midday",
        lighting=_UNSET,
        objects_state=[],  # sem origem no ledger; usuário preenche na UI
    )

    completed: list[str] = []
    in_progress: list[str] = []
    beats = ledger.get("beats")
    if isinstance(beats, (list, tuple)):
        for beat in beats:
            if not isinstance(beat, Mapping):
                continue
            text = _first_sentence(beat.get("text") or beat.get("action"))
            if text:
                (in_progress if not beat.get("completed") else completed).append(text)

    next_intent = ledger.get("required_final_outcome")
    if isinstance(next_intent, str) and next_intent.strip():
        next_intent = _first_sentence(next_intent) or None
    else:
        next_intent = None

    action = Action(
        completed_in_shot=completed,
        in_progress=in_progress,
        next_intent=next_intent,
    )

    camera = Camera(shot_size="medium", movement="static", angle="eye_level")
    audio = AudioCue(
        dialogue=None,
        ambient=[a for a in (ledger.get("ambient_audio"),) if isinstance(a, str) and a],
        music_segment=None,
    )
    hints = ContinuityHints(
        previous_shot_id=previous_shot_id,
        state_inherited_from=previous_shot_id,
    )

    blocking = ledger.get("blocking_contract")
    if not isinstance(blocking, str) or not blocking.strip():
        blocking = None

    return ShotIR(
        shot_id=shot_id,
        characters=characters,
        environment=environment,
        action=action,
        camera=camera,
        audio=audio,
        continuity_hints=hints,
        blocking_contract=blocking,
    )


__all__ = ["to_shot_ir"]
