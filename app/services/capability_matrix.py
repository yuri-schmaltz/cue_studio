"""CapabilityMatrix service (A34 / R04).

Expõe capacidades efetivas por modelo × runtime × modo para que a UI e
os adaptadores possam consultar o que cada modelo realmente suporta,
em vez de assumir capacidades a partir do nome comercial da família.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a34_capability_matrix.py``.
"""

from __future__ import annotations

import json
import os
import tempfile
import warnings
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

SCHEMA_VERSION = "1.0"


class Capability(str, Enum):
    TEXT_TO_VIDEO = "text_to_video"
    IMAGE_TO_VIDEO = "image_to_video"
    FIRST_LAST_FRAME = "first_last_frame"
    EXTEND = "extend"
    AUDIO_INPUT = "audio_input"
    AUDIO_GENERATE = "audio_generate"
    MULTI_WINDOW = "multi_window"
    LORA_SUPPORT = "lora_support"
    UPSCALE = "upscale"
    OUTPAINT = "outpaint"
    INPAINT = "inpaint"
    REF2V = "ref2v"
    FL2VA = "fl2va"
    TEXT_TO_IMAGE = "text_to_image"
    TEXT_TO_SPEECH = "text_to_speech"
    MUSIC_GEN = "music_gen"


class Runtime(str, Enum):
    WAN_GP = "wan_gp"
    DIFFUSERS = "diffusers"
    COMFY = "comfy"


@dataclass(frozen=True)
class CapabilityEntry:
    model_id: str
    runtime: Runtime
    mode: str
    capabilities: frozenset


def default_catalog() -> list[CapabilityEntry]:
    return [
        CapabilityEntry("minimax_h3_omni_pruned", Runtime.WAN_GP, "t2v",
                         frozenset({Capability.TEXT_TO_VIDEO, Capability.AUDIO_GENERATE, Capability.MULTI_WINDOW, Capability.LORA_SUPPORT, Capability.FL2VA})),
        CapabilityEntry("minimax_h3_first_last", Runtime.WAN_GP, "fl2v",
                         frozenset({Capability.FIRST_LAST_FRAME, Capability.MULTI_WINDOW, Capability.LORA_SUPPORT})),
        CapabilityEntry("ltx25_distilled", Runtime.WAN_GP, "t2v",
                         frozenset({Capability.TEXT_TO_VIDEO, Capability.IMAGE_TO_VIDEO, Capability.MULTI_WINDOW, Capability.LORA_SUPPORT, Capability.OUTPAINT})),
        CapabilityEntry("ltx25_dev", Runtime.WAN_GP, "t2v",
                         frozenset({Capability.TEXT_TO_VIDEO, Capability.IMAGE_TO_VIDEO, Capability.MULTI_WINDOW, Capability.LORA_SUPPORT})),
        CapabilityEntry("wan_2_2_5b", Runtime.WAN_GP, "t2v",
                         frozenset({Capability.TEXT_TO_VIDEO, Capability.IMAGE_TO_VIDEO, Capability.LORA_SUPPORT})),
        CapabilityEntry("wan_2_1_1_3b", Runtime.WAN_GP, "t2v",
                         frozenset({Capability.TEXT_TO_VIDEO, Capability.IMAGE_TO_VIDEO})),
        CapabilityEntry("scail2_14b_fast", Runtime.WAN_GP, "animate",
                         frozenset({Capability.FL2VA, Capability.LORA_SUPPORT})),
        CapabilityEntry("flux_2_klein_9b", Runtime.DIFFUSERS, "t2i",
                         frozenset({Capability.TEXT_TO_IMAGE, Capability.LORA_SUPPORT, Capability.UPSCALE})),
        CapabilityEntry("qwen_image_edit", Runtime.DIFFUSERS, "edit",
                         frozenset({Capability.INPAINT, Capability.OUTPAINT})),
        CapabilityEntry("qwen3_tts", Runtime.COMFY, "speech",
                         frozenset({Capability.AUDIO_GENERATE, Capability.TEXT_TO_SPEECH})),
        CapabilityEntry("kugelaudio", Runtime.COMFY, "speech",
                         frozenset({Capability.AUDIO_GENERATE, Capability.TEXT_TO_SPEECH})),
        CapabilityEntry("ace_step_15_xl_sft", Runtime.COMFY, "music",
                         frozenset({Capability.AUDIO_GENERATE, Capability.MUSIC_GEN})),
        CapabilityEntry("minimax_music3", Runtime.COMFY, "music",
                         frozenset({Capability.AUDIO_GENERATE, Capability.MUSIC_GEN})),
        CapabilityEntry("mmaudio", Runtime.COMFY, "sfx",
                         frozenset({Capability.AUDIO_GENERATE})),
    ]


class CapabilityMatrix:
    def __init__(self, entries: Optional[list[CapabilityEntry]] = None):
        self.entries = entries if entries is not None else default_catalog()

    def for_model(self, model_id: str) -> list[CapabilityEntry]:
        return [e for e in self.entries if e.model_id == model_id]

    def for_model_runtime(self, model_id: str, runtime: Runtime) -> list[CapabilityEntry]:
        return [e for e in self.entries if e.model_id == model_id and e.runtime == runtime]

    def check(self, model_id: str, runtime: Runtime, mode: str, capability: Capability) -> bool:
        for e in self.entries:
            if e.model_id == model_id and e.runtime == runtime and e.mode == mode:
                return capability in e.capabilities
        return False

    def filter_by_capability(self, capability: Capability) -> list[CapabilityEntry]:
        return [e for e in self.entries if capability in e.capabilities]

    def capabilities_for(self, model_id: str, runtime: Runtime, mode: str) -> frozenset:
        for e in self.entries:
            if e.model_id == model_id and e.runtime == runtime and e.mode == mode:
                return e.capabilities
        return frozenset()


def _default_matrix_path() -> Path:
    cache_dir = Path(os.environ.get("APP_CACHE_DIR", "")) if os.environ.get("APP_CACHE_DIR") else None
    if cache_dir is None:
        cache_dir = Path(__file__).resolve().parents[1] / ".cache"
    return cache_dir / "capability_matrix.json"


def save_matrix_atomic(matrix: CapabilityMatrix, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "entries": [
            {
                "model_id": e.model_id,
                "runtime": e.runtime.value,
                "mode": e.mode,
                "capabilities": sorted(c.value for c in e.capabilities),
            }
            for e in matrix.entries
        ],
    }
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_matrix(path: Path) -> CapabilityMatrix:
    if not path.exists():
        return CapabilityMatrix()
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != SCHEMA_VERSION:
        import warnings
        warnings.warn(f"schema_version={payload.get('schema_version')} desconhecida", stacklevel=2)
    entries = [
        CapabilityEntry(
            model_id=e["model_id"],
            runtime=Runtime(e["runtime"]),
            mode=e["mode"],
            capabilities=frozenset(Capability(c) for c in e["capabilities"]),
        )
        for e in payload.get("entries", [])
    ]
    return CapabilityMatrix(entries)


# Singleton
_instance: Optional[CapabilityMatrix] = None


def get_capability_matrix() -> CapabilityMatrix:
    global _instance
    if _instance is None:
        path = _default_matrix_path()
        _instance = load_matrix(path)
        if not path.exists():
            save_matrix_atomic(_instance, path)
    return _instance


def reset_capability_matrix_singleton() -> None:
    global _instance
    _instance = None
