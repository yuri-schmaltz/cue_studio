"""Continuity check — detector de inconsistências entre planos (A25).

Regras determinísticas que comparam pares adjacentes de :class:`ShotIR` e
emitem :class:`Inconsistency` com severidade ``info`` / ``warning`` /
``error``. Portado do protótipo autoritativo ``a25_shot_ir.py``
(spec 31 seção 3.3). Por padrão é **aviso**, nunca bloqueia geração
(spec 2.2).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable

from .shot_ir_schema import CharacterInShot, ShotIR


class Severity(str, Enum):
    """Severidade de uma inconsistência de continuidade."""

    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass
class Inconsistency:
    """Uma inconsistência detectada entre (ou dentro de) planos."""

    kind: str  # ex.: "gaze_flip", "wardrobe_skip", "object_hand_jump"
    severity: Severity
    shot_id_a: str
    shot_id_b: str
    message: str
    evidence: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Representação JSON-serializável para API/logs."""
        return {
            "kind": self.kind,
            "severity": self.severity.value,
            "shot_id_a": self.shot_id_a,
            "shot_id_b": self.shot_id_b,
            "message": self.message,
            "evidence": self.evidence,
        }


# Pares de direções opostas (giro de 180°) para a regra gaze_flip.
_FLIP_PAIRS = {
    "screen_left": "screen_right",
    "screen_right": "screen_left",
    "screen_up": "screen_down",
    "screen_down": "screen_up",
    "into_camera": "away",
    "away": "into_camera",
}


def _char_by_id(shot: ShotIR, char_id: str) -> CharacterInShot | None:
    for c in shot.characters:
        if c.id == char_id:
            return c
    return None


def rule_gaze_flip(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    """Olhar virou 180° entre planos consecutivos sem justificativa."""
    for ca in a.characters:
        cb = _char_by_id(b, ca.id)
        if cb is None:
            continue
        if _FLIP_PAIRS.get(ca.gaze.direction) == cb.gaze.direction:
            out.append(Inconsistency(
                kind="gaze_flip",
                severity=Severity.WARNING,
                shot_id_a=a.shot_id,
                shot_id_b=b.shot_id,
                message=(
                    f"Personagem {ca.id} mudou gaze de "
                    f"{ca.gaze.direction} → {cb.gaze.direction} entre planos "
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
                severity=Severity.WARNING,
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
    """Objeto trocou de mão (swap left↔right) sem ação explícita."""
    for ca in a.characters:
        cb = _char_by_id(b, ca.id)
        if cb is None:
            continue
        hands_a, hands_b = ca.hands, cb.hands
        if hands_a.left == hands_b.left and hands_a.right == hands_b.right:
            continue
        swapped = (
            hands_a.left == hands_b.right
            and hands_a.right == hands_b.left
            and (hands_a.left is not None or hands_a.right is not None)
        )
        if swapped:
            out.append(Inconsistency(
                kind="object_hand_jump",
                severity=Severity.INFO,
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
    """Estado de objeto mudou sem ação correspondente no plano anterior."""
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
                    severity=Severity.WARNING,
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
    """``action.in_progress`` do plano A não foi completada no plano B."""
    for intent in a.action.in_progress:
        if intent and intent not in b.action.completed_in_shot:
            out.append(Inconsistency(
                kind="action_orphan",
                severity=Severity.WARNING,
                shot_id_a=a.shot_id,
                shot_id_b=b.shot_id,
                message=(
                    f"Ação em progresso no plano A ({intent!r}) não foi "
                    f"completada no plano B."
                ),
                evidence={"intent": intent},
            ))


def rule_position_collision(a: ShotIR, b: ShotIR, out: list[Inconsistency]) -> None:
    """Dois personagens no mesmo ``frame`` (dentro de cada plano)."""
    for shot in (a, b):
        frames = [c.position.frame for c in shot.characters]
        if len(frames) != len(set(frames)):
            out.append(Inconsistency(
                kind="position_collision",
                severity=Severity.ERROR,
                shot_id_a=shot.shot_id,
                shot_id_b=shot.shot_id,
                message=(
                    f"Dois ou mais personagens no mesmo frame "
                    f"({frames}). Considere realocar."
                ),
                evidence={"frames": frames},
            ))


RULES: tuple[Callable[[ShotIR, ShotIR, list[Inconsistency]], None], ...] = (
    rule_gaze_flip,
    rule_wardrobe_skip,
    rule_object_hand_jump,
    rule_object_state_unsupported,
    rule_action_orphan,
    rule_position_collision,
)


def check_sequence(shots: list[ShotIR]) -> list[Inconsistency]:
    """Compara planos adjacentes e emite inconsistências com severidade.

    A regra ``position_collision`` também roda sozinha (dentro de cada
    plano), pois é intra-plano. Retorna a lista completa, sem ordenação
    garantida além da ordem de execução das regras.
    """
    out: list[Inconsistency] = []
    for rule in RULES:
        for a, b in zip(shots, shots[1:]):
            rule(a, b, out)
    for shot in shots:
        rule_position_collision(shot, shot, out)
    return out


def severity_counts(findings: list[Inconsistency]) -> dict[str, int]:
    """Contadores por severidade (para o painel de continuidade)."""
    counts = {s.value: 0 for s in Severity}
    for f in findings:
        counts[f.severity.value] += 1
    return counts


__all__ = [
    "Severity",
    "Inconsistency",
    "RULES",
    "rule_gaze_flip",
    "rule_wardrobe_skip",
    "rule_object_hand_jump",
    "rule_object_state_unsupported",
    "rule_action_orphan",
    "rule_position_collision",
    "check_sequence",
    "severity_counts",
]
