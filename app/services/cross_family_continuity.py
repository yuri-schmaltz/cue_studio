"""Cross-family continuity adapter (A25b / R10).

Adapter genérico de continuidade para Wan/LTX/Hunyuan, análogo aos
`Picture N` labels do H3, agnóstico de modelo.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a25b_cross_family_continuity.py``.
"""

from __future__ import annotations

import json
import os
import tempfile
import warnings
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional


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
    shot_id: str
    last_frame_path: Optional[str] = None
    first_frame_path: Optional[str] = None
    picture_n_index: Optional[int] = None
    subject_bindings: tuple[tuple[str, str], ...] = ()
    speaker_bindings: tuple[tuple[str, str], ...] = ()
    lora_refs: tuple[str, ...] = ()
    multi_window_state: Optional[dict] = None
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class StoryBibleRefs:
    subject_ids: tuple[str, ...] = ()
    setting_ids: tuple[str, ...] = ()
    object_ids: tuple[str, ...] = ()
    motifs: tuple[str, ...] = ()


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


def detect_family(model_id: str) -> ModelFamily:
    """Detecta família do modelo a partir do ID."""
    mid = (model_id or "").lower()
    if "h3_omni" in mid or "h3omni" in mid:
        return ModelFamily.H3_OMNI
    if "h3" in mid or "minimax" in mid:
        return ModelFamily.H3
    if "ltx25" in mid or "ltx-2.5" in mid or "ltx_2.5" in mid:
        return ModelFamily.LTX25
    if "ltx" in mid:
        return ModelFamily.LTX
    if "wan" in mid:
        return ModelFamily.WAN
    if "hunyuan" in mid:
        return ModelFamily.HUNYUAN
    return ModelFamily.UNKNOWN


class ContinuityRegistry:
    def __init__(self):
        self._adapters: dict[ModelFamily, Any] = {}

    def register(self, family: ModelFamily, adapter: Any) -> None:
        self._adapters[family] = adapter

    def resolve(self, family: ModelFamily) -> Any:
        return self._adapters.get(family)

    def has(self, family: ModelFamily) -> bool:
        return family in self._adapters


# Adapters simplificados (implementação mínima)
class _BaseAdapter:
    family: ModelFamily = ModelFamily.UNKNOWN

    def infer_blocking_contract(
        self,
        subject_ids: tuple[str, ...] = (),
        setting_id: Optional[str] = None,
        object_states: tuple[tuple[str, str], ...] = (),
        gaze_targets: tuple[tuple[str, str], ...] = (),
        wardrobe_versions: tuple[tuple[str, str], ...] = (),
    ) -> BlockingContract:
        return BlockingContract(
            subject_ids=subject_ids,
            setting_id=setting_id,
            object_state_match=object_states,
            gaze_targets=gaze_targets,
            wardrobe_versions=wardrobe_versions,
            requires_previous_frame=False,
            requires_first_frame=False,
            notes=("base",),
        )

    def apply_continuity(
        self,
        previous_output: PreviousShotOutput,
        contract: BlockingContract,
    ) -> ContinuationStrategy:
        return ContinuationStrategy(
            mode="independent",
            payload={},
            confidence=0.0,
            adapter_family=self.family,
            notes=("independent (base)",),
        )


class H3Adapter(_BaseAdapter):
    family = ModelFamily.H3

    def apply_continuity(self, previous_output, contract):
        if previous_output.picture_n_index is None:
            return ContinuationStrategy(
                mode="independent", payload={}, confidence=0.0,
                adapter_family=self.family, notes=("H3 sem Picture N",),
            )
        return ContinuationStrategy(
            mode="picture_n_reference",
            payload={"picture_n": previous_output.picture_n_index},
            confidence=0.9,
            adapter_family=self.family,
            notes=("H3 Picture N",),
        )


class H3OmniAdapter(_BaseAdapter):
    family = ModelFamily.H3_OMNI

    def apply_continuity(self, previous_output, contract):
        if not previous_output.subject_bindings and previous_output.picture_n_index is None:
            return ContinuationStrategy(
                mode="independent", payload={}, confidence=0.0,
                adapter_family=self.family, notes=("H3 Omni sem bindings",),
            )
        return ContinuationStrategy(
            mode="subject_binding",
            payload={
                "subject_bindings": [list(p) for p in previous_output.subject_bindings],
                "speaker_bindings": [list(p) for p in previous_output.speaker_bindings],
            },
            confidence=0.95,
            adapter_family=self.family,
            notes=("H3 Omni subject+speaker binding",),
        )


class LTXAdapter(_BaseAdapter):
    family = ModelFamily.LTX

    def apply_continuity(self, previous_output, contract):
        if previous_output.last_frame_path is None:
            return ContinuationStrategy(
                mode="independent", payload={}, confidence=0.0,
                adapter_family=self.family, notes=("LTX sem last frame",),
            )
        return ContinuationStrategy(
            mode="first_last_frame",
            payload={"last_frame": previous_output.last_frame_path},
            confidence=0.8,
            adapter_family=self.family,
            notes=("LTX first/last frame",),
        )


class LTX25Adapter(_BaseAdapter):
    family = ModelFamily.LTX25

    def apply_continuity(self, previous_output, contract):
        if previous_output.multi_window_state is None and previous_output.last_frame_path is None:
            return ContinuationStrategy(
                mode="independent", payload={}, confidence=0.0,
                adapter_family=self.family, notes=("LTX25 sem estado",),
            )
        payload = {}
        if previous_output.last_frame_path:
            payload["last_frame"] = previous_output.last_frame_path
        if previous_output.multi_window_state:
            payload["multi_window"] = previous_output.multi_window_state
        return ContinuationStrategy(
            mode="first_last_frame",
            payload=payload,
            confidence=0.85,
            adapter_family=self.family,
            notes=("LTX25 first/last frame + multi-window",),
        )


class WanAdapter(_BaseAdapter):
    family = ModelFamily.WAN

    def apply_continuity(self, previous_output, contract):
        if not previous_output.lora_refs:
            return ContinuationStrategy(
                mode="independent", payload={}, confidence=0.0,
                adapter_family=self.family, notes=("Wan sem LoRA refs",),
            )
        return ContinuationStrategy(
            mode="picture_n_reference",
            payload={"lora_refs": list(previous_output.lora_refs)},
            confidence=0.7,
            adapter_family=self.family,
            notes=("Wan LoRA-based continuity",),
        )


class HunyuanAdapter(_BaseAdapter):
    family = ModelFamily.HUNYUAN

    def apply_continuity(self, previous_output, contract):
        return ContinuationStrategy(
            mode="independent",
            payload={},
            confidence=0.5,
            adapter_family=self.family,
            notes=("Hunyuan: independent (sem continuidade nativa)",),
        )


class IndependentFallbackAdapter(_BaseAdapter):
    family = ModelFamily.UNKNOWN

    def apply_continuity(self, previous_output, contract):
        return ContinuationStrategy(
            mode="independent",
            payload={},
            confidence=0.0,
            adapter_family=self.family,
            notes=("fallback: modelo desconhecido, continuidade independente",),
        )


def create_default_registry() -> ContinuityRegistry:
    reg = ContinuityRegistry()
    reg.register(ModelFamily.H3, H3Adapter())
    reg.register(ModelFamily.H3_OMNI, H3OmniAdapter())
    reg.register(ModelFamily.LTX, LTXAdapter())
    reg.register(ModelFamily.LTX25, LTX25Adapter())
    reg.register(ModelFamily.WAN, WanAdapter())
    reg.register(ModelFamily.HUNYUAN, HunyuanAdapter())
    reg.register(ModelFamily.UNKNOWN, IndependentFallbackAdapter())
    return reg


def resolve_continuity(
    model_id: str,
    previous_output: Optional[PreviousShotOutput],
    contract: Optional[BlockingContract] = None,
    registry: Optional[ContinuityRegistry] = None,
) -> ContinuationStrategy:
    """Orquestra detecção de família + adapter + aplicação de continuidade."""
    if registry is None:
        registry = create_default_registry()
    family = detect_family(model_id)
    adapter = registry.resolve(family)
    if adapter is None:
        adapter = registry.resolve(ModelFamily.UNKNOWN)
    if previous_output is None:
        return ContinuationStrategy(
            mode="independent", payload={}, confidence=0.0,
            adapter_family=family, notes=("sem previous_output",),
        )
    if contract is None:
        contract = adapter.infer_blocking_contract()
    return adapter.apply_continuity(previous_output, contract)
