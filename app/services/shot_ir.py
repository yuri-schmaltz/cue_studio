"""Shot IR + continuity check (A25).

Schema do Shot IR (Intermediate Representation) com validação, 6 regras de
continuity check (gaze_flip, wardrobe_skip, object_hand_jump,
object_state_unsupported, action_orphan, position_collision), round-trip
JSON atômico, backward compatibility.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a25_shot_ir.py``.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import warnings
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal, Optional

VALID_FRAMES = ("screen_left", "screen_center", "screen_right", "off_screen")
VALID_GAZE_DIRS = (
    "screen_left", "screen_right", "screen_up", "screen_down",
    "into_camera", "away",
)
VALID_TIME_OF_DAY = ("dawn", "morning", "midday", "afternoon", "dusk", "night")
VALID_SHOT_SIZES = (
    "extreme_wide", "wide", "medium_wide", "medium",
    "medium_close_up", "close_up", "extreme_close_up",
)
VALID_CAMERA_MOVES = ("static", "pan", "tilt", "dolly", "tracking", "handheld")
VALID_CAMERA_ANGLES = ("eye_level", "high", "low", "dutch")


class ShotIRValidationError(ValueError):
    pass


def _ensure(value, allowed, name):
    if value not in allowed:
        raise ShotIRValidationError(f"{name}={value!r} não está em {allowed}")


def _ensure_unit_interval(value, name):
    if not (0.0 <= value <= 1.0):
        raise ShotIRValidationError(f"{name}={value} fora de [0.0, 1.0]")


@dataclass
class Position:
    x: float
    y: float
    z: float
    frame: str

    def validate(self):
        _ensure_unit_interval(self.x, "position.x")
        _ensure_unit_interval(self.y, "position.y")
        if not (-2.0 <= self.z <= 2.0):
            raise ShotIRValidationError(f"position.z={self.z} fora de [-2.0, 2.0]")
        _ensure(self.frame, VALID_FRAMES, "position.frame")


@dataclass
class Gaze:
    direction: str
    target: Optional[str] = None

    def validate(self):
        _ensure(self.direction, VALID_GAZE_DIRS, "gaze.direction")


@dataclass
class HandState:
    left: Optional[str] = None
    right: Optional[str] = None


@dataclass
class CharacterInShot:
    id: str
    position: Position
    gaze: Gaze
    hands: HandState
    wardrobe_version: str
    expression: str
    posture: str

    def validate(self):
        if not self.id:
            raise ShotIRValidationError("character.id vazio")
        self.position.validate()
        self.gaze.validate()


@dataclass
class ObjectState:
    id: str
    state: str


@dataclass
class Environment:
    location_id: str
    time_of_day: str
    lighting: str
    objects_state: list[ObjectState] = field(default_factory=list)

    def validate(self):
        if not self.location_id:
            raise ShotIRValidationError("environment.location_id vazio")
        _ensure(self.time_of_day, VALID_TIME_OF_DAY, "environment.time_of_day")


@dataclass
class Action:
    completed_in_shot: list[str] = field(default_factory=list)
    in_progress: list[str] = field(default_factory=list)
    next_intent: Optional[str] = None


@dataclass
class Camera:
    shot_size: str
    movement: str
    angle: str

    def validate(self):
        _ensure(self.shot_size, VALID_SHOT_SIZES, "camera.shot_size")
        _ensure(self.movement, VALID_CAMERA_MOVES, "camera.movement")
        _ensure(self.angle, VALID_CAMERA_ANGLES, "camera.angle")


@dataclass
class AudioCue:
    dialogue: Optional[str] = None
    ambient: list[str] = field(default_factory=list)
    music_segment: Optional[str] = None


@dataclass
class ContinuityHints:
    previous_shot_id: Optional[str] = None
    state_inherited_from: Optional[str] = None


@dataclass
class ShotIR:
    schema_version: str
    shot_id: str
    characters: list[CharacterInShot]
    environment: Environment
    action: Action
    camera: Camera
    audio: AudioCue
    continuity_hints: ContinuityHints
    blocking_contract: Optional[str] = None

    SUPPORTED_VERSIONS = ("1.0",)

    def validate(self):
        if self.schema_version not in self.SUPPORTED_VERSIONS:
            raise ShotIRValidationError(
                f"schema_version={self.schema_version} não suportada; "
                f"use uma de {self.SUPPORTED_VERSIONS}"
            )
        if not self.shot_id:
            raise ShotIRValidationError("shot_id vazio")
        for c in self.characters:
            c.validate()
        self.environment.validate()
        self.camera.validate()


# ---------------------------------------------------------------------------
# Round-trip JSON atômico
# ---------------------------------------------------------------------------

def shotir_to_dict(shot: ShotIR) -> dict:
    def _to_dict(obj):
        if hasattr(obj, "__dataclass_fields__"):
            return {k: _to_dict(v) for k, v in asdict(obj).items()}
        if isinstance(obj, list):
            return [_to_dict(x) for x in obj]
        return obj
    return _to_dict(shot)


def dict_to_shotir(payload: dict) -> ShotIR:
    if "schema_version" not in payload:
        raise ShotIRValidationError("payload sem schema_version")
    chars = [
        CharacterInShot(
            id=c["id"],
            position=Position(**c["position"]),
            gaze=Gaze(**c["gaze"]),
            hands=HandState(**c["hands"]),
            wardrobe_version=c["wardrobe_version"],
            expression=c["expression"],
            posture=c["posture"],
        )
        for c in payload["characters"]
    ]
    env = payload["environment"]
    objs = [ObjectState(**o) for o in env.get("objects_state", [])]
    return ShotIR(
        schema_version=payload["schema_version"],
        shot_id=payload["shot_id"],
        characters=chars,
        environment=Environment(
            location_id=env["location_id"],
            time_of_day=env["time_of_day"],
            lighting=env["lighting"],
            objects_state=objs,
        ),
        action=Action(**payload["action"]),
        camera=Camera(**payload["camera"]),
        audio=AudioCue(**payload["audio"]),
        continuity_hints=ContinuityHints(**payload["continuity_hints"]),
        blocking_contract=payload.get("blocking_contract"),
    )


def save_shotir_atomic(shot: ShotIR, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    shot.validate()
    payload = shotir_to_dict(shot)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if Path(tmp).exists():
            Path(tmp).unlink()
        raise


def load_shotir(path: Path) -> ShotIR:
    payload = json.loads(path.read_text(encoding="utf-8"))
    sv = payload.get("schema_version")
    if sv not in ShotIR.SUPPORTED_VERSIONS:
        import warnings
        warnings.warn(f"schema_version={sv!r} desconhecida; tentando ler como legado", stacklevel=2)
    return dict_to_shotir(payload)


# ---------------------------------------------------------------------------
# 6 regras de continuity check
# ---------------------------------------------------------------------------

@dataclass
class Inconsistency:
    kind: str
    severity: str
    shot_id_a: str
    shot_id_b: str
    message: str
    evidence: dict


def _char_by_id(shot: ShotIR, char_id: str):
    for c in shot.characters:
        if c.id == char_id:
            return c
    return None


def rule_gaze_flip(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    for ca in a.characters:
        cb = _char_by_id(b, ca.id)
        if cb is None:
            continue
        flip_pairs = {
            "screen_left": "screen_right",
            "screen_right": "screen_left",
            "screen_up": "screen_down",
            "screen_down": "screen_up",
            "into_camera": "away",
            "away": "into_camera",
        }
        if flip_pairs.get(ca.gaze.direction) == cb.gaze.direction:
            out.append(Inconsistency(
                kind="gaze_flip",
                severity="warning",
                shot_id_a=a.shot_id,
                shot_id_b=b.shot_id,
                message=f"Personagem {ca.id} mudou gaze de {ca.gaze.direction} → {cb.gaze.direction} entre shots consecutivos sem evento explícito.",
                evidence={"character_id": ca.id, "from": ca.gaze.direction, "to": cb.gaze.direction},
            ))


def rule_wardrobe_skip(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    for ca in a.characters:
        cb = _char_by_id(b, ca.id)
        if cb is None:
            continue
        if ca.wardrobe_version != cb.wardrobe_version:
            out.append(Inconsistency(
                kind="wardrobe_skip",
                severity="warning",
                shot_id_a=a.shot_id,
                shot_id_b=b.shot_id,
                message=f"Personagem {ca.id} trocou de figurino {ca.wardrobe_version} → {cb.wardrobe_version} sem registro na bíblia visual.",
                evidence={"character_id": ca.id, "from": ca.wardrobe_version, "to": cb.wardrobe_version},
            ))


def rule_object_hand_jump(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    for ca in a.characters:
        cb = _char_by_id(b, ca.id)
        if cb is None:
            continue
        hands_a = ca.hands
        hands_b = cb.hands
        same = hands_a.left == hands_b.left and hands_a.right == hands_b.right
        if same:
            continue
        swapped = (
            hands_a.left == hands_b.right
            and hands_a.right == hands_b.left
            and (hands_a.left is not None or hands_a.right is not None)
        )
        if swapped:
            out.append(Inconsistency(
                kind="object_hand_jump",
                severity="info",
                shot_id_a=a.shot_id,
                shot_id_b=b.shot_id,
                message=f"Personagem {ca.id} trocou objetos entre as mãos sem ação explícita registrada.",
                evidence={"character_id": ca.id, "from": {"left": hands_a.left, "right": hands_a.right}, "to": {"left": hands_b.left, "right": hands_b.right}},
            ))


def rule_object_state_unsupported(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    states_a = {o.id: o.state for o in a.environment.objects_state}
    for ob in b.environment.objects_state:
        if ob.id in states_a and states_a[ob.id] != ob.state:
            action_describes_change = any(
                ob.id.lower() in c.lower() or ob.state.lower() in c.lower()
                for c in (a.action.completed_in_shot + a.action.in_progress)
            )
            if not action_describes_change:
                out.append(Inconsistency(
                    kind="object_state_unsupported",
                    severity="warning",
                    shot_id_a=a.shot_id,
                    shot_id_b=b.shot_id,
                    message=f"Objeto {ob.id} mudou estado {states_a[ob.id]} → {ob.state} sem ação explícita.",
                    evidence={"object_id": ob.id, "from": states_a[ob.id], "to": ob.state},
                ))


def rule_action_orphan(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    for intent in a.action.in_progress:
        if intent and intent not in b.action.completed_in_shot:
            out.append(Inconsistency(
                kind="action_orphan",
                severity="warning",
                shot_id_a=a.shot_id,
                shot_id_b=b.shot_id,
                message=f"Ação em progresso no Shot A ({intent!r}) não foi completada no Shot B.",
                evidence={"intent": intent},
            ))


def rule_position_collision(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    for shot in (a, b):
        frames = [c.position.frame for c in shot.characters]
        if len(frames) != len(set(frames)):
            out.append(Inconsistency(
                kind="position_collision",
                severity="error",
                shot_id_a=shot.shot_id,
                shot_id_b=shot.shot_id,
                message=f"Dois ou mais personagens no mesmo frame ({frames}). Considere realocar.",
                evidence={"frames": frames},
            ))


RULES = (
    rule_gaze_flip,
    rule_wardrobe_skip,
    rule_object_hand_jump,
    rule_object_state_unsupported,
    rule_action_orphan,
    rule_position_collision,
)


def check_sequence(shots: list[ShotIR]) -> list[Inconsistency]:
    out: list[Inconsistency] = []
    for rule in RULES:
        for a, b in zip(shots, shots[1:]):
            rule(a, b, out)
    for shot in shots:
        rule_position_collision(shot, shot, out)
    return out
