#!/usr/bin/env python3
"""Protótipo isolado do Shot IR + continuity check (A25).

Este script valida a estratégia proposta em `31-feature-a25-shot-ir.md`
**sem** importar de `app/` (que está protegido pela política atual do
Reversa). O objetivo é demonstrar:

1. Schema do Shot IR pode ser expresso com `@dataclass` + validação manual
   reproduzindo o que o Pydantic faria no Cue Studio (a versão final
   trocará `dataclass` por `pydantic.BaseModel`).
2. As 6 regras de continuidade check podem ser funções puras que
   recebem `list[ShotIR]` e retornam `list[Inconsistency]`.
3. Round-trip JSON funciona atômico: escreve em `.tmp`, valida, faz rename.
4. Backward compatibility: schema_version desconhecido gera warning, não crash.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a25_shot_ir.py

Saída esperada: 7 checks OK.
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


# ---------------------------------------------------------------------------
# 1. Schema do Shot IR (dataclasses com validação manual)
# ---------------------------------------------------------------------------

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
    direction: str
    target: Optional[str] = None

    def validate(self) -> None:
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

    def validate(self) -> None:
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

    def validate(self) -> None:
        if not self.location_id:
            raise ShotIRValidationError("environment.location_id vazio")
        _ensure(self.time_of_day, VALID_TIME_OF_DAY, "environment.time_of_day")


@dataclass
class Action:
    completed_in_shot: list[str]
    in_progress: list[str]
    next_intent: Optional[str] = None


@dataclass
class Camera:
    shot_size: str
    movement: str
    angle: str

    def validate(self) -> None:
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


# ---------------------------------------------------------------------------
# 2. Round-trip JSON atômico
# ---------------------------------------------------------------------------

def shotir_to_dict(shot: ShotIR) -> dict:
    def _to_dict(obj: Any) -> Any:
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
    fd, tmp = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
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
        warnings.warn(
            f"schema_version={sv!r} desconhecida; tentando ler como legado",
            stacklevel=2,
        )
    return dict_to_shotir(payload)


# ---------------------------------------------------------------------------
# 3. Continuity check (6 regras)
# ---------------------------------------------------------------------------

@dataclass
class Inconsistency:
    kind: str
    severity: str  # info | warning | error
    shot_id_a: str
    shot_id_b: str
    message: str
    evidence: dict


def _same_id(char: CharacterInShot, char_id: str) -> bool:
    return char.id == char_id


def _char_by_id(shot: ShotIR, char_id: str) -> Optional[CharacterInShot]:
    for c in shot.characters:
        if c.id == char_id:
            return c
    return None


def rule_gaze_flip(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    """Olhar virou 180° entre shots consecutivos sem justificativa."""
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
                message=(
                    f"Personagem {ca.id} mudou gaze de "
                    f"{ca.gaze.direction} → {cb.gaze.direction} entre shots "
                    f"consecutivos sem evento explícito."
                ),
                evidence={
                    "character_id": ca.id,
                    "from": ca.gaze.direction,
                    "to": cb.gaze.direction,
                },
            ))


def rule_wardrobe_skip(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    """Figurino mudou sem entrada de wardrobe_version nova."""
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
                message=(
                    f"Personagem {ca.id} trocou de figurino "
                    f"{ca.wardrobe_version} → {cb.wardrobe_version} sem "
                    f"registro na bíblia visual."
                ),
                evidence={
                    "character_id": ca.id,
                    "from": ca.wardrobe_version,
                    "to": cb.wardrobe_version,
                },
            ))


def rule_object_hand_jump(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    """Objeto trocou de mão sem ação explícita."""
    for ca in a.characters:
        cb = _char_by_id(b, ca.id)
        if cb is None:
            continue
        hands_a = ca.hands
        hands_b = cb.hands
        # Detecta o padrão "swap" (left↔right) entre shots consecutivos,
        # mas só quando há de fato um objeto trocado de mão (pelo menos
        # um dos pares difere de None e é diferente da configuração
        # original). Estado idêntico em ambos os shots não é problema.
        same = (
            hands_a.left == hands_b.left
            and hands_a.right == hands_b.right
        )
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
                message=(
                    f"Personagem {ca.id} trocou objetos entre as mãos "
                    f"sem ação explícita registrada."
                ),
                evidence={
                    "character_id": ca.id,
                    "from": {"left": hands_a.left, "right": hands_a.right},
                    "to": {"left": hands_b.left, "right": hands_b.right},
                },
            ))


def rule_object_state_unsupported(
    a: ShotIR, b: ShotIR, out: list[Inconsistency]
) -> None:
    """Estado de objeto mudou sem ação correspondente."""
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
                    message=(
                        f"Objeto {ob.id} mudou estado "
                        f"{states_a[ob.id]} → {ob.state} sem ação explícita."
                    ),
                    evidence={
                        "object_id": ob.id,
                        "from": states_a[ob.id],
                        "to": ob.state,
                    },
                ))


def rule_action_orphan(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    """action.in_progress no Shot A não aparece em completed_in_shot do B."""
    for intent in a.action.in_progress:
        if intent and intent not in b.action.completed_in_shot:
            out.append(Inconsistency(
                kind="action_orphan",
                severity="warning",
                shot_id_a=a.shot_id,
                shot_id_b=b.shot_id,
                message=(
                    f"Ação em progresso no Shot A ({intent!r}) não foi "
                    f"completada no Shot B."
                ),
                evidence={"intent": intent},
            ))


def rule_position_collision(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    """Dois personagens no mesmo frame no mesmo shot."""
    for shot in (a, b):
        frames = [c.position.frame for c in shot.characters]
        if len(frames) != len(set(frames)):
            out.append(Inconsistency(
                kind="position_collision",
                severity="error",
                shot_id_a=shot.shot_id,
                shot_id_b=shot.shot_id,
                message=(
                    f"Dois ou mais personagens no mesmo frame "
                    f"({frames}). Considere realocar."
                ),
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


# ---------------------------------------------------------------------------
# 4. Suíte de testes do protótipo
# ---------------------------------------------------------------------------

def make_ana() -> CharacterInShot:
    return CharacterInShot(
        id="char_ana",
        position=Position(0.3, 0.5, 0.0, "screen_left"),
        gaze=Gaze("screen_right", target="char_joao"),
        hands=HandState(left="obj_cup", right=None),
        wardrobe_version="wardrobe_v2",
        expression="neutral",
        posture="standing",
    )


def make_joao() -> CharacterInShot:
    return CharacterInShot(
        id="char_joao",
        position=Position(0.7, 0.5, 0.0, "screen_right"),
        gaze=Gaze("screen_left", target="char_ana"),
        hands=HandState(left=None, right=None),
        wardrobe_version="wardrobe_v1",
        expression="smiling",
        posture="standing",
    )


def make_shot(
    shot_id: str,
    prev_id: Optional[str],
    extra: Optional[dict] = None,
) -> ShotIR:
    extra = extra or {}
    return ShotIR(
        schema_version="1.0",
        shot_id=shot_id,
        characters=[make_ana(), make_joao()],
        environment=Environment(
            location_id=extra.get("location", "loc_kitchen"),
            time_of_day="morning",
            lighting="natural_window_left",
            objects_state=extra.get(
                "objects",
                [ObjectState("obj_fridge", "closed")],
            ),
        ),
        action=Action(
            completed_in_shot=extra.get("completed", []),
            in_progress=extra.get("in_progress", []),
            next_intent=extra.get("next_intent"),
        ),
        camera=Camera(shot_size="medium", movement="static", angle="eye_level"),
        audio=AudioCue(dialogue=extra.get("dialogue")),
        continuity_hints=ContinuityHints(
            previous_shot_id=prev_id,
            state_inherited_from=prev_id,
        ),
        blocking_contract=None,
    )


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_schema_validation() -> bool:
    s = make_shot("shot_001", None)
    try:
        s.validate()
        return check("schema_validation: aceita IR válido", True)
    except ShotIRValidationError as e:
        return check("schema_validation: aceita IR válido", False, str(e))


def test_unknown_version_accepted_with_warning() -> bool:
    payload = shotir_to_dict(make_shot("shot_001", None))
    payload["schema_version"] = "2.0"  # futura
    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as fh:
        json.dump(payload, fh)
        tmp_path = Path(fh.name)
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            shot = load_shotir(tmp_path)
        warned = any("schema_version" in str(w.message) for w in caught)
        ok = shot.shot_id == "shot_001" and warned
        return check(
            "unknown_version: aceita e avisa, sem crash",
            ok,
            f"warnings={len(caught)}",
        )
    finally:
        tmp_path.unlink(missing_ok=True)


def test_atomic_roundtrip() -> bool:
    s = make_shot("shot_007", "shot_006")
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "shots" / "shot_007.shot_ir.json"
        save_shotir_atomic(s, path)
        loaded = load_shotir(path)
        ok = (
            loaded.shot_id == "shot_007"
            and loaded.environment.location_id == "loc_kitchen"
            and len(loaded.characters) == 2
        )
        return check("atomic_roundtrip: JSON salva e recupera", ok, str(path))


def test_clean_sequence_no_findings() -> bool:
    s1 = make_shot("shot_001", None)
    s2 = make_shot("shot_002", "shot_001")
    s3 = make_shot("shot_003", "shot_002")
    findings = check_sequence([s1, s2, s3])
    return check(
        "clean_sequence: 0 inconsistências em sequência correta",
        len(findings) == 0,
        f"found={len(findings)}",
    )


def test_gaze_flip_detected() -> bool:
    s1 = make_shot("shot_001", None)
    s2 = make_shot("shot_002", "shot_001")
    # Inverte gaze da Ana de screen_right para screen_left
    s2.characters[0].gaze.direction = "screen_left"
    findings = check_sequence([s1, s2])
    kinds = {f.kind for f in findings}
    ok = "gaze_flip" in kinds
    return check(
        "gaze_flip: detectado",
        ok,
        f"kinds={kinds}",
    )


def test_object_state_unsupported_detected() -> bool:
    s1 = make_shot("shot_001", None)
    s2 = make_shot("shot_002", "shot_001")
    s2.environment.objects_state[0].state = "open"
    findings = check_sequence([s1, s2])
    kinds = {f.kind for f in findings}
    ok = "object_state_unsupported" in kinds
    return check(
        "object_state_unsupported: detectado",
        ok,
        f"kinds={kinds}",
    )


def test_action_orphan_detected() -> bool:
    s1 = make_shot("shot_001", None, {
        "in_progress": ["Ana serve o café"],
    })
    s2 = make_shot("shot_002", "shot_001")
    findings = check_sequence([s1, s2])
    kinds = {f.kind for f in findings}
    ok = "action_orphan" in kinds
    return check(
        "action_orphan: detectado",
        ok,
        f"kinds={kinds}",
    )


def main() -> int:
    print("== A25 Shot IR prototype ==")
    tests = [
        test_schema_validation,
        test_unknown_version_accepted_with_warning,
        test_atomic_roundtrip,
        test_clean_sequence_no_findings,
        test_gaze_flip_detected,
        test_object_state_unsupported_detected,
        test_action_orphan_detected,
    ]
    failures = 0
    for t in tests:
        if not t():
            failures += 1
    print()
    if failures == 0:
        print(f"PASS {len(tests)}/{len(tests)} checks")
        return 0
    print(f"FAIL {failures}/{len(tests)} checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())