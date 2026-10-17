#!/usr/bin/env python3
"""Protótipo isolado do cross-family continuity adapter (A25b / R10).

Valida `41-feature-a25b-cross-family-continuity.md` **sem** importar de
`app/`. Reproduz o que será implementado em
`app/services/director/cross_family_continuity.py` quando a política
Reversa liberar `allowedPaths`.

Conteúdo:
  1. Modelo de dados (enums + dataclasses)
  2. Interface `ContinuityAdapter` (Protocol)
  3. Adapters por família: H3, H3 Omni, LTX, LTX25, Wan, Hunyuan
  4. Fallback `IndependentFallbackAdapter`
  5. `ContinuityRegistry` (registra e resolve)
  6. Função `resolve_continuity(...)` — orquestra A34 + A25b + A25
  7. Suíte de testes (8 testes)

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a25b_cross_family_continuity.py

Saída esperada: 8 checks OK.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import warnings
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional, Protocol

# Reusa ShotIR canônico do A25 sem acoplar (definições locais mantidas
# simétricas para sobreviver se o A25 for refatorado).
_PROTOS = Path(__file__).parent
sys.path.insert(0, str(_PROTOS))
from a25_shot_ir import (  # type: ignore
    ShotIR, CharacterInShot, ObjectState, Environment, Action,
    Camera, AudioCue, ContinuityHints, Position, Gaze, HandState,
)


# ---------------------------------------------------------------------------
# 1. Modelo de dados
# ---------------------------------------------------------------------------

class ModelFamily(str, Enum):
    H3 = "h3"
    H3_OMNI = "h3_omni"
    LTX = "ltx"
    LTX25 = "ltx25"
    WAN = "wan"
    HUNYUAN = "hunyuan"
    UNKNOWN = "unknown"


STRATEGY_MODES = (
    "first_last_frame",
    "extend_previous",
    "picture_n_reference",
    "subject_binding",
    "independent",
)


@dataclass(frozen=True)
class PreviousShotOutput:
    """Artefatos produzidos pelo Shot anterior."""
    shot_id: str
    last_frame_path: Optional[str] = None
    first_frame_path: Optional[str] = None
    picture_n_index: Optional[int] = None      # índice do H3 Omni
    subject_bindings: tuple[tuple[str, str], ...] = ()  # [(subject_id, asset_id)]
    speaker_bindings: tuple[tuple[str, str], ...] = ()  # [(speaker_id, asset_id)]
    lora_refs: tuple[str, ...] = ()
    # Estado interno da janela multi-window (LTX/LTX25)
    multi_window_state: Optional[dict] = None
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class StoryBibleRefs:
    """Subset da Story Bible usado pelos adapters."""
    subject_ids: tuple[str, ...] = ()       # personagems canônicos
    setting_ids: tuple[str, ...] = ()      # locações canônicas
    object_ids: tuple[str, ...] = ()       # objetos críticos
    motifs: tuple[str, ...] = ()           # motivos recorrentes


@dataclass(frozen=True)
class BlockingContract:
    subject_ids: tuple[str, ...]
    setting_id: Optional[str]
    object_state_match: tuple[tuple[str, str], ...]
    gaze_targets: tuple[tuple[str, str], ...]
    wardrobe_versions: tuple[tuple[str, str], ...]
    requires_previous_frame: bool
    requires_first_frame: bool
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class ContinuationStrategy:
    mode: str
    payload: dict
    confidence: float
    adapter_family: ModelFamily
    notes: tuple[str, ...] = ()

    def validate(self) -> None:
        if self.mode not in STRATEGY_MODES:
            raise ValueError(f"mode inválido: {self.mode}")
        if not (0.0 <= self.confidence <= 1.0):
            raise ValueError(f"confidence fora de [0,1]: {self.confidence}")


# ---------------------------------------------------------------------------
# 2. Interface
# ---------------------------------------------------------------------------

class ContinuityAdapter(Protocol):
    family: ModelFamily

    def extract_state(
        self, previous_output: PreviousShotOutput, sidecar_dir: Path
    ) -> Optional[ShotIR]:
        ...

    def infer_blocking_contract(
        self,
        shot_ir: ShotIR,
        bible_refs: Optional[StoryBibleRefs] = None,
    ) -> BlockingContract:
        ...

    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: Optional[ShotIR],
        previous_output: PreviousShotOutput,
    ) -> ContinuationStrategy:
        ...


# ---------------------------------------------------------------------------
# 3. Adapters por família
# ---------------------------------------------------------------------------

class _BaseAdapter:
    family: ModelFamily = ModelFamily.UNKNOWN

    def extract_state(
        self, previous_output: PreviousShotOutput, sidecar_dir: Path
    ) -> Optional[ShotIR]:
        sidecar = sidecar_dir / f"{previous_output.shot_id}.shot_ir.json"
        if not sidecar.exists():
            return None
        try:
            with sidecar.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)
            return _shotir_from_dict(payload)
        except (OSError, ValueError):
            return None

    def infer_blocking_contract(
        self,
        shot_ir: ShotIR,
        bible_refs: Optional[StoryBibleRefs] = None,
    ) -> BlockingContract:
        subject_ids = tuple(c.id for c in shot_ir.characters)
        setting_id = shot_ir.environment.location_id
        obj_states = tuple(
            (o.id, o.state) for o in shot_ir.environment.objects_state
        )
        gazes = tuple(
            (c.id, c.gaze.target or c.gaze.direction)
            for c in shot_ir.characters if c.gaze.target or c.gaze.direction != "into_camera"
        )
        wardrobes = tuple((c.id, c.wardrobe_version) for c in shot_ir.characters)
        return BlockingContract(
            subject_ids=subject_ids,
            setting_id=setting_id,
            object_state_match=obj_states,
            gaze_targets=gazes,
            wardrobe_versions=wardrobes,
            requires_previous_frame=False,
            requires_first_frame=False,
            notes=("base",),
        )

    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: Optional[ShotIR],
        previous_output: PreviousShotOutput,
    ) -> ContinuationStrategy:
        raise NotImplementedError


class H3Adapter(_BaseAdapter):
    family = ModelFamily.H3

    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: Optional[ShotIR],
        previous_output: PreviousShotOutput,
    ) -> ContinuationStrategy:
        if previous_output.picture_n_index is None:
            return ContinuationStrategy(
                mode="independent",
                payload={},
                confidence=0.0,
                adapter_family=self.family,
                notes=("H3 sem Picture N index; usando independent",),
            )
        payload = {
            "picture_n": previous_output.picture_n_index,
            "subject_ids": list(contract.subject_ids),
            "setting_id": contract.setting_id,
            "wardrobe_versions": [list(p) for p in contract.wardrobe_versions],
        }
        return ContinuationStrategy(
            mode="picture_n_reference",
            payload=payload,
            confidence=0.9,
            adapter_family=self.family,
            notes=("H3 base; usar binding simples",),
        )


class H3OmniAdapter(_BaseAdapter):
    family = ModelFamily.H3_OMNI

    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: Optional[ShotIR],
        previous_output: PreviousShotOutput,
    ) -> ContinuationStrategy:
        # H3 Omni sempre vincula subject + speaker quando disponíveis.
        subject_pairs = list(previous_output.subject_bindings)
        speaker_pairs = list(previous_output.speaker_bindings)
        if not subject_pairs and previous_output.picture_n_index is None:
            return ContinuationStrategy(
                mode="independent",
                payload={},
                confidence=0.0,
                adapter_family=self.family,
                notes=("H3 Omni sem bindings; usando independent",),
            )
        payload = {
            "subject_bindings": [list(p) for p in subject_pairs],
            "speaker_bindings": [list(p) for p in speaker_pairs],
            "picture_n": previous_output.picture_n_index,
        }
        return ContinuationStrategy(
            mode="subject_binding",
            payload=payload,
            confidence=0.95,
            adapter_family=self.family,
            notes=("H3 Omni; bindings fortes",),
        )


class LTXAdapter(_BaseAdapter):
    family = ModelFamily.LTX

    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: Optional[ShotIR],
        previous_output: PreviousShotOutput,
    ) -> ContinuationStrategy:
        if previous_output.last_frame_path is None:
            return ContinuationStrategy(
                mode="independent",
                payload={},
                confidence=0.0,
                adapter_family=self.family,
                notes=("LTX sem last_frame_path; usando independent",),
            )
        # Janela multi-window: encadear 24 frames como extend_previous.
        multi = previous_output.multi_window_state or {}
        extend_window = multi.get("next_window_size", 24)
        payload = {
            "extend_frames": extend_window,
            "last_frame_path": previous_output.last_frame_path,
            "target_window": multi.get("next_window_id", "window_N+1"),
        }
        return ContinuationStrategy(
            mode="extend_previous",
            payload=payload,
            confidence=0.85,
            adapter_family=self.family,
            notes=("LTX multi-window",),
        )


class LTX25Adapter(LTXAdapter):
    family = ModelFamily.LTX25
    # LTX25 herda de LTX; apenas marcador de família e notas diferentes.


class WanAdapter(_BaseAdapter):
    family = ModelFamily.WAN

    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: Optional[ShotIR],
        previous_output: PreviousShotOutput,
    ) -> ContinuationStrategy:
        # Wan usa first_last_frame; precisa do last_frame do Shot N
        # e (opcionalmente) first_frame para clamping.
        if previous_output.last_frame_path is None:
            return ContinuationStrategy(
                mode="independent",
                payload={},
                confidence=0.0,
                adapter_family=self.family,
                notes=("Wan sem last_frame_path; usando independent",),
            )
        payload = {
            "last_frame_path": previous_output.last_frame_path,
            "first_frame_path": previous_output.first_frame_path,
            "ref_image_path": previous_output.last_frame_path,
        }
        return ContinuationStrategy(
            mode="first_last_frame",
            payload=payload,
            confidence=0.8,
            adapter_family=self.family,
            notes=("Wan fl2v",),
        )


class HunyuanAdapter(_BaseAdapter):
    family = ModelFamily.HUNYUAN

    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: Optional[ShotIR],
        previous_output: PreviousShotOutput,
    ) -> ContinuationStrategy:
        if previous_output.first_frame_path is None and previous_output.last_frame_path is None:
            return ContinuationStrategy(
                mode="independent",
                payload={},
                confidence=0.0,
                adapter_family=self.family,
                notes=("Hunyuan sem refs; usando independent",),
            )
        payload = {
            "ref_image_path": previous_output.first_frame_path or previous_output.last_frame_path,
        }
        return ContinuationStrategy(
            mode="first_last_frame",
            payload=payload,
            confidence=0.7,
            adapter_family=self.family,
            notes=("Hunyuan i2v",),
        )


class IndependentFallbackAdapter(_BaseAdapter):
    """Fallback explícito. Sempre retorna INDEPENDENT com confidence 0.0."""

    family = ModelFamily.UNKNOWN

    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: Optional[ShotIR],
        previous_output: PreviousShotOutput,
    ) -> ContinuationStrategy:
        notes = ("fallback: sem adapter nativo",)
        if previous_state is None and not contract.subject_ids:
            notes = notes + ("corte intencional",)
        return ContinuationStrategy(
            mode="independent",
            payload={},
            confidence=0.0,
            adapter_family=self.family,
            notes=notes,
        )


# ---------------------------------------------------------------------------
# 4. Registry
# ---------------------------------------------------------------------------

class ContinuityRegistry:
    def __init__(self) -> None:
        self._adapters: dict[ModelFamily, ContinuityAdapter] = {}
        self.fallback_used: list[tuple[str, ModelFamily]] = []
        self.fallback: ContinuityAdapter = IndependentFallbackAdapter()

    def register(self, adapter: ContinuityAdapter) -> None:
        self._adapters[adapter.family] = adapter

    def resolve(self, family: ModelFamily) -> ContinuityAdapter:
        if family in self._adapters:
            return self._adapters[family]
        self.fallback_used.append(("resolve", family))
        return self.fallback

    def available_families(self) -> list[ModelFamily]:
        return sorted(self._adapters.keys(), key=lambda f: f.value)


# ---------------------------------------------------------------------------
# 5. Orquestrador
# ---------------------------------------------------------------------------

def _shotir_from_dict(payload: dict) -> ShotIR:
    """Decodifica um Shot IR canônico a partir de JSON."""
    chars = []
    for c in payload["characters"]:
        p = c["position"]
        g = c["gaze"]
        chars.append(CharacterInShot(
            id=c["id"],
            position=Position(p["x"], p["y"], p["z"], p["frame"]),
            gaze=Gaze(g["direction"], g.get("target")),
            hands=HandState(c["hands"].get("left"), c["hands"].get("right")),
            wardrobe_version=c["wardrobe_version"],
            expression=c["expression"],
            posture=c["posture"],
        ))
    env = payload["environment"]
    objs = [ObjectState(o["id"], o["state"]) for o in env["objects_state"]]
    act = payload["action"]
    cam = payload["camera"]
    aud = payload["audio"]
    ch = payload["continuity_hints"]
    return ShotIR(
        schema_version=payload.get("schema_version", "1.0"),
        shot_id=payload["shot_id"],
        characters=chars,
        environment=Environment(
            location_id=env["location_id"],
            time_of_day=env["time_of_day"],
            lighting=env["lighting"],
            objects_state=objs,
        ),
        action=Action(
            completed_in_shot=act["completed_in_shot"],
            in_progress=act["in_progress"],
            next_intent=act.get("next_intent"),
        ),
        camera=Camera(
            shot_size=cam["shot_size"],
            movement=cam["movement"],
            angle=cam["angle"],
        ),
        audio=AudioCue(
            dialogue=aud.get("dialogue"),
            ambient=aud.get("ambient", []),
            music_segment=aud.get("music_segment"),
        ),
        continuity_hints=ContinuityHints(
            previous_shot_id=ch.get("previous_shot_id"),
            state_inherited_from=ch.get("state_inherited_from"),
        ),
        blocking_contract=payload.get("blocking_contract"),
    )


def resolve_continuity(
    *,
    registry: ContinuityRegistry,
    next_shot_ir: ShotIR,
    director_strategy: str,
    family: ModelFamily,
    previous_output: Optional[PreviousShotOutput],
    previous_state: Optional[ShotIR],
    bible_refs: Optional[StoryBibleRefs] = None,
    sidecar_dir: Optional[Path] = None,
) -> ContinuationStrategy:
    """Resolve a estratégia de continuidade final."""
    if director_strategy == "independent":
        return ContinuationStrategy(
            mode="independent",
            payload={},
            confidence=0.0,
            adapter_family=family,
            notes=("director_strategy=independent; corte frio explícito",),
        )

    adapter = registry.resolve(family)
    contract = adapter.infer_blocking_contract(next_shot_ir, bible_refs)
    if director_strategy == "extend_previous" and family not in (ModelFamily.LTX, ModelFamily.LTX25):
        # força extend_previous mesmo em família não nativa
        strategy = adapter.apply_continuity(
            next_shot_ir, contract, previous_state,
            previous_output or PreviousShotOutput(shot_id=next_shot_ir.shot_id),
        )
        if strategy.mode != "extend_previous" and previous_output is not None and previous_output.last_frame_path is not None:
            return ContinuationStrategy(
                mode="extend_previous",
                payload={"last_frame_path": previous_output.last_frame_path, "forced": True},
                confidence=max(0.4, strategy.confidence * 0.6),
                adapter_family=strategy.adapter_family,
                notes=strategy.notes + ("forced extend_previous",),
            )
        return strategy

    return adapter.apply_continuity(
        next_shot_ir, contract, previous_state,
        previous_output or PreviousShotOutput(shot_id=next_shot_ir.shot_id),
    )


# ---------------------------------------------------------------------------
# 6. Suíte de testes (8 testes)
# ---------------------------------------------------------------------------

def _mk_shot_ir(shot_id: str, prev_id: Optional[str] = None, *, location: str = "loc_kitchen") -> ShotIR:
    return ShotIR(
        schema_version="1.0",
        shot_id=shot_id,
        characters=[
            CharacterInShot(
                id="char_ana",
                position=Position(0.3, 0.5, 0.0, "screen_left"),
                gaze=Gaze("screen_right", target="char_joao"),
                hands=HandState(left="obj_cup", right=None),
                wardrobe_version="wardrobe_v2",
                expression="neutral",
                posture="standing",
            ),
            CharacterInShot(
                id="char_joao",
                position=Position(0.7, 0.5, 0.0, "screen_right"),
                gaze=Gaze("screen_left", target="char_ana"),
                hands=HandState(left=None, right=None),
                wardrobe_version="wardrobe_v1",
                expression="smiling",
                posture="standing",
            ),
        ],
        environment=Environment(
            location_id=location,
            time_of_day="morning",
            lighting="natural_window_left",
            objects_state=[ObjectState("obj_fridge", "closed")],
        ),
        action=Action(completed_in_shot=[], in_progress=[], next_intent=None),
        camera=Camera(shot_size="medium", movement="static", angle="eye_level"),
        audio=AudioCue(dialogue=None, ambient=[], music_segment=None),
        continuity_hints=ContinuityHints(
            previous_shot_id=prev_id,
            state_inherited_from=prev_id,
        ),
        blocking_contract=None,
    )


def _registry() -> ContinuityRegistry:
    r = ContinuityRegistry()
    r.register(H3Adapter())
    r.register(H3OmniAdapter())
    r.register(LTXAdapter())
    r.register(LTX25Adapter())
    r.register(WanAdapter())
    r.register(HunyuanAdapter())
    return r


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_h3_picture_n_extraction_and_apply() -> bool:
    r = _registry()
    next_shot = _mk_shot_ir("shot_002", prev_id="shot_001")
    out = resolve_continuity(
        registry=r,
        next_shot_ir=next_shot,
        director_strategy="continuous",
        family=ModelFamily.H3,
        previous_output=PreviousShotOutput(
            shot_id="shot_001",
            picture_n_index=3,
        ),
        previous_state=None,
    )
    out.validate()
    return check(
        "H3 picture_n_reference aplica com confidence 0.9",
        out.mode == "picture_n_reference"
        and out.confidence == 0.9
        and out.payload.get("picture_n") == 3,
        f"mode={out.mode}, conf={out.confidence}, payload={out.payload}",
    )


def test_h3_omni_subject_binding() -> bool:
    r = _registry()
    next_shot = _mk_shot_ir("shot_002", prev_id="shot_001")
    out = resolve_continuity(
        registry=r,
        next_shot_ir=next_shot,
        director_strategy="continuous",
        family=ModelFamily.H3_OMNI,
        previous_output=PreviousShotOutput(
            shot_id="shot_001",
            picture_n_index=2,
            subject_bindings=(("char_ana", "asset_ana_ref"),),
            speaker_bindings=(("char_joao", "asset_joao_voice"),),
        ),
        previous_state=None,
    )
    return check(
        "H3 Omni subject_binding",
        out.mode == "subject_binding"
        and out.confidence == 0.95
        and len(out.payload["subject_bindings"]) == 1
        and len(out.payload["speaker_bindings"]) == 1,
        f"mode={out.mode}, conf={out.confidence}, keys={list(out.payload)}",
    )


def test_ltx_extend_previous_with_multi_window() -> bool:
    r = _registry()
    next_shot = _mk_shot_ir("shot_002", prev_id="shot_001")
    out = resolve_continuity(
        registry=r,
        next_shot_ir=next_shot,
        director_strategy="continuous",
        family=ModelFamily.LTX,
        previous_output=PreviousShotOutput(
            shot_id="shot_001",
            last_frame_path="/tmp/shot_001_last.png",
            multi_window_state={"next_window_size": 24, "next_window_id": "window_002"},
        ),
        previous_state=None,
    )
    return check(
        "LTX extend_previous com payload multi-window",
        out.mode == "extend_previous"
        and out.payload["extend_frames"] == 24
        and out.payload["target_window"] == "window_002"
        and out.confidence == 0.85,
        f"mode={out.mode}, extend={out.payload.get('extend_frames')}",
    )


def test_wan_fl2v_uses_last_frame() -> bool:
    r = _registry()
    next_shot = _mk_shot_ir("shot_002", prev_id="shot_001")
    out = resolve_continuity(
        registry=r,
        next_shot_ir=next_shot,
        director_strategy="continuous",
        family=ModelFamily.WAN,
        previous_output=PreviousShotOutput(
            shot_id="shot_001",
            last_frame_path="/tmp/shot_001_last.png",
            first_frame_path="/tmp/shot_001_first.png",
        ),
        previous_state=None,
    )
    return check(
        "Wan first_last_frame com ref image",
        out.mode == "first_last_frame"
        and out.payload["last_frame_path"] == "/tmp/shot_001_last.png"
        and out.payload["ref_image_path"] == "/tmp/shot_001_last.png"
        and out.confidence == 0.8,
        f"mode={out.mode}, last={out.payload.get('last_frame_path')}",
    )


def test_h3_independent_fallback_when_no_picture_n() -> bool:
    r = _registry()
    next_shot = _mk_shot_ir("shot_002", prev_id="shot_001")
    out = resolve_continuity(
        registry=r,
        next_shot_ir=next_shot,
        director_strategy="continuous",
        family=ModelFamily.H3,
        previous_output=PreviousShotOutput(shot_id="shot_001"),  # sem picture_n_index
        previous_state=None,
    )
    return check(
        "H3 sem Picture N → independent com confidence 0.0",
        out.mode == "independent"
        and out.confidence == 0.0
        and out.adapter_family == ModelFamily.H3,
        f"mode={out.mode}, conf={out.confidence}",
    )


def test_unknown_family_falls_back_to_independent_and_telemetry() -> bool:
    r = _registry()
    next_shot = _mk_shot_ir("shot_002", prev_id="shot_001")
    # Família não registrada (CogVideoX fictício)
    out = resolve_continuity(
        registry=r,
        next_shot_ir=next_shot,
        director_strategy="continuous",
        family=ModelFamily.UNKNOWN,
        previous_output=PreviousShotOutput(shot_id="shot_001"),
        previous_state=None,
    )
    return check(
        "Família desconhecida → fallback INDEPENDENT + telemetria",
        out.mode == "independent"
        and out.confidence == 0.0
        and out.adapter_family == ModelFamily.UNKNOWN
        and any("resolve" in str(item) for item in r.fallback_used),
        f"fallback_used={r.fallback_used}",
    )


def test_director_strategy_independent_short_circuits() -> bool:
    r = _registry()
    next_shot = _mk_shot_ir("shot_002", prev_id="shot_001")
    out = resolve_continuity(
        registry=r,
        next_shot_ir=next_shot,
        director_strategy="independent",
        family=ModelFamily.H3_OMNI,
        previous_output=PreviousShotOutput(
            shot_id="shot_001", picture_n_index=1,
        ),
        previous_state=None,
    )
    return check(
        "director_strategy=independent bypassa adapter",
        out.mode == "independent"
        and out.adapter_family == ModelFamily.H3_OMNI
        and any("director_strategy" in n for n in out.notes),
        f"notes={out.notes}",
    )


def test_forced_extend_previous_on_wan() -> bool:
    r = _registry()
    next_shot = _mk_shot_ir("shot_002", prev_id="shot_001")
    out = resolve_continuity(
        registry=r,
        next_shot_ir=next_shot,
        director_strategy="extend_previous",
        family=ModelFamily.WAN,
        previous_output=PreviousShotOutput(
            shot_id="shot_001",
            last_frame_path="/tmp/shot_001_last.png",
        ),
        previous_state=None,
    )
    return check(
        "extend_previous forçado em Wan → extend com confidence reduzida",
        out.mode == "extend_previous"
        and out.payload.get("forced") is True
        and out.payload["last_frame_path"] == "/tmp/shot_001_last.png"
        and 0.0 <= out.confidence <= 0.8,
        f"mode={out.mode}, conf={out.confidence}, payload={out.payload}",
    )


def main() -> int:
    print("== A25b Cross-family continuity adapter ==")
    tests = [
        test_h3_picture_n_extraction_and_apply,
        test_h3_omni_subject_binding,
        test_ltx_extend_previous_with_multi_window,
        test_wan_fl2v_uses_last_frame,
        test_h3_independent_fallback_when_no_picture_n,
        test_unknown_family_falls_back_to_independent_and_telemetry,
        test_director_strategy_independent_short_circuits,
        test_forced_extend_previous_on_wan,
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
