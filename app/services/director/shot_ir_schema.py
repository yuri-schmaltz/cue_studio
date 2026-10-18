"""Shot IR — estado narrativo estruturado por plano (A25).

Schema versionado (``schema_version = "1.0"``) para o estado explícito de
cada Shot: posição dos personagens, direção do olhar, objeto em cada mão,
estado de portas/objetos, figurino, ação concluída/em progresso e intenção
da próxima ação. Portado do protótipo autoritativo
``_reversa_forward/plano-2026-10-04/prototypes/a25_shot_ir.py``.

Os modelos usam ``@dataclass`` + validação manual (padrão do
``app/services/director/schema.py``), em vez de Pydantic; a validação
reproduz exatamente o contrato da spec
``31-feature-a25-shot-ir.md`` seção 3.1.

Leitura de payloads com ``schema_version`` desconhecida emite ``warnings``
em vez de levantar erro (backward compatibility).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


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
VALID_CAMERA_MOVES = (
    "static", "pan", "tilt", "dolly", "tracking", "handheld",
)
VALID_CAMERA_ANGLES = ("eye_level", "high", "low", "dutch")

SHOT_IR_SCHEMA_VERSION = "1.0"
SHOT_IR_SUPPORTED_VERSIONS = (SHOT_IR_SCHEMA_VERSION,)


class ShotIRValidationError(ValueError):
    """Erro de validação do Shot IR."""


def _ensure(value: Any, allowed: tuple, name: str) -> None:
    if value not in allowed:
        raise ShotIRValidationError(f"{name}={value!r} não está em {allowed}")


def _ensure_unit_interval(value: float, name: str) -> None:
    if not (0.0 <= value <= 1.0):
        raise ShotIRValidationError(f"{name}={value} fora de [0.0, 1.0]")


@dataclass
class Position:
    """Posição do personagem no quadro (normalizada + lado do frame)."""

    x: float
    y: float
    z: float
    frame: str

    def validate(self) -> None:
        _ensure_unit_interval(self.x, "position.x")
        _ensure_unit_interval(self.y, "position.y")
        if not (-2.0 <= self.z <= 2.0):
            raise ShotIRValidationError(f"position.z={self.z} fora de [-2.0, 2.0]")
        _ensure(self.frame, VALID_FRAMES, "position.frame")


@dataclass
class Gaze:
    """Direção do olhar e alvo opcional (character_id ou object_id)."""

    direction: str
    target: Optional[str] = None

    def validate(self) -> None:
        _ensure(self.direction, VALID_GAZE_DIRS, "gaze.direction")


@dataclass
class HandState:
    """Objeto em cada mão (asset_id) — ``None`` = mão vazia."""

    left: Optional[str] = None
    right: Optional[str] = None


@dataclass
class CharacterInShot:
    """Personagem presente no plano, com estado físico explícito."""

    id: str
    position: Position
    gaze: Gaze
    hands: HandState
    wardrobe_version: str
    expression: str
    posture: str

    def validate(self) -> None:
        if not self.id:
            raise ShotIRValidationError("character.id vazio")
        self.position.validate()
        self.gaze.validate()


@dataclass
class ObjectState:
    """Estado discreto de um objeto/porteira do cenário."""

    id: str
    state: str  # string controlada (closed, open, half_open, on, off, broken, ...)


@dataclass
class Environment:
    """Local, período, iluminação e estado dos objetos do cenário."""

    location_id: str
    time_of_day: str
    lighting: str
    objects_state: list[ObjectState] = field(default_factory=list)

    def validate(self) -> None:
        if not self.location_id:
            raise ShotIRValidationError("environment.location_id vazio")
        _ensure(self.time_of_day, VALID_TIME_OF_DAY, "environment.time_of_day")


@dataclass
class Action:
    """Ações concluídas, em progresso e intenção da próxima ação."""

    completed_in_shot: list[str] = field(default_factory=list)
    in_progress: list[str] = field(default_factory=list)
    next_intent: Optional[str] = None


@dataclass
class Camera:
    """Enquadramento e movimento de câmera do plano."""

    shot_size: str
    movement: str
    angle: str

    def validate(self) -> None:
        _ensure(self.shot_size, VALID_SHOT_SIZES, "camera.shot_size")
        _ensure(self.movement, VALID_CAMERA_MOVES, "camera.movement")
        _ensure(self.angle, VALID_CAMERA_ANGLES, "camera.angle")


@dataclass
class AudioCue:
    """Diálogo, ambiências e segmento musical do plano."""

    dialogue: Optional[str] = None
    ambient: list[str] = field(default_factory=list)
    music_segment: Optional[str] = None


@dataclass
class ContinuityHints:
    """Referências ao plano anterior para costura de continuidade."""

    previous_shot_id: Optional[str] = None
    state_inherited_from: Optional[str] = None  # shot_id do qual o estado foi herdado


@dataclass
class ShotIR:
    """Estado narrativo completo e validável de um Shot (schema 1.0)."""

    shot_id: str
    characters: list[CharacterInShot]
    environment: Environment
    action: Action
    camera: Camera
    audio: AudioCue
    continuity_hints: ContinuityHints
    schema_version: str = SHOT_IR_SCHEMA_VERSION
    blocking_contract: Optional[str] = None  # derivado de h3_story_ledger

    SUPPORTED_VERSIONS = SHOT_IR_SUPPORTED_VERSIONS

    def validate(self) -> None:
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


# ------------------------------------------------------------------
# Serialização round-trip (dict ↔ dataclass)
# ------------------------------------------------------------------

def shotir_to_dict(shot: ShotIR) -> dict:
    """Converte o Shot IR em dict JSON-serializável."""

    def _to_dict(obj: Any) -> Any:
        if hasattr(obj, "__dataclass_fields__"):
            return {k: _to_dict(v) for k, v in obj.__dict__.items()}
        if isinstance(obj, list):
            return [_to_dict(x) for x in obj]
        return obj

    return _to_dict(shot)


def dict_to_shotir(payload: dict) -> ShotIR:
    """Reconstrói um Shot IR a partir de dict; valida o contrato 1.0."""

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
    shot = ShotIR(
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
    # Versões futuras são lidas como legado (com warning no store); a
    # validação estrita só se aplica às versões suportadas.
    if shot.schema_version in SHOT_IR_SUPPORTED_VERSIONS:
        shot.validate()
    return shot


__all__ = [
    "SHOT_IR_SCHEMA_VERSION",
    "SHOT_IR_SUPPORTED_VERSIONS",
    "ShotIRValidationError",
    "Position",
    "Gaze",
    "HandState",
    "CharacterInShot",
    "ObjectState",
    "Environment",
    "Action",
    "Camera",
    "AudioCue",
    "ContinuityHints",
    "ShotIR",
    "shotir_to_dict",
    "dict_to_shotir",
]
