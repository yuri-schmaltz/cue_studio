"""CapabilityMatrix — capacidades por modelo/runtime/modo (A34 / R04).

Matriz declarativa consultável ``(model_id, runtime, mode) → set[Capability]``,
com catálogo inicial dos modelos do Cue Studio v2.5.2. Portada do protótipo
autoritativo ``prototypes/a34_capability_matrix.py``.

Diferença do protótipo: o catálogo é **declarado** (dados puros) e a classe
fica em torno dele; o protótipo constrói entradas inline. O comportamento de
lookup/check/filter é idêntico. A matriz versionada é persistida em
``app/capabilities_matrix.json`` (spec 37 §2.1); sem arquivo, o catálogo
embutido é usado como default.

A checagem de capabilities é puramente declarativa — não há inferência
dinâmica (spec 2.2, fora de escopo).
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import warnings
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Optional


CAPABILITY_SCHEMA_VERSION = "1.0"


class Capability(str, Enum):
    """Capabilities suportadas (spec 37 §3 + extras do catálogo v2.5.2)."""

    TEXT_TO_VIDEO = "text_to_video"
    IMAGE_TO_VIDEO = "image_to_video"
    FIRST_LAST_FRAME = "first_last_frame"
    EXTEND = "extend"
    AUDIO_INPUT = "audio_input"
    AUDIO_GENERATE = "audio_generate"
    MULTI_WINDOW = "multi_window"
    LORA_SUPPORT = "lora_support"
    QUANTIZATION = "quantization"
    CONTROLNET = "controlnet"
    UPSCALE = "upscale"
    OUTPAINT = "outpaint"
    INPAINT = "inpaint"
    REF2V = "ref2v"
    FL2VA = "fl2va"
    # Extras presentes no catálogo inicial v2.5.2 (protótipo).
    TEXT_TO_IMAGE = "text_to_image"
    TEXT_TO_SPEECH = "text_to_speech"
    MUSIC_GEN = "music_gen"


class Runtime(str, Enum):
    """Runtimes de inferência suportados."""

    WAN_GP = "wan_gp"
    DIFFUSERS = "diffusers"
    COMFY = "comfy"


@dataclass(frozen=True)
class CapabilityEntry:
    """Linha da matriz: um (modelo, runtime, modo) e suas capabilities."""

    model_id: str
    runtime: Runtime
    mode: str  # "t2v" | "i2v" | "fl2v" | "t2i" | "edit" | "speech" | "music" | ...
    capabilities: frozenset[Capability]


def _entry(
    model_id: str, runtime: Runtime, mode: str, caps: Iterable[str]
) -> CapabilityEntry:
    return CapabilityEntry(
        model_id=model_id,
        runtime=runtime,
        mode=mode,
        capabilities=frozenset(Capability(c) for c in caps),
    )


def default_catalog() -> list[CapabilityEntry]:
    """Catálogo inicial v2.5.2 (spec 37 §4; 14 entradas do protótipo)."""
    return [
        _entry("minimax_h3_omni_pruned", Runtime.WAN_GP, "t2v", [
            "text_to_video", "audio_generate", "multi_window",
            "lora_support", "fl2va",
        ]),
        _entry("minimax_h3_first_last", Runtime.WAN_GP, "fl2v", [
            "first_last_frame", "multi_window", "lora_support",
        ]),
        _entry("ltx25_distilled", Runtime.WAN_GP, "t2v", [
            "text_to_video", "image_to_video", "multi_window",
            "lora_support", "outpaint",
        ]),
        _entry("ltx25_dev", Runtime.WAN_GP, "t2v", [
            "text_to_video", "image_to_video", "multi_window",
            "lora_support",
        ]),
        _entry("wan_2_2_5b", Runtime.WAN_GP, "t2v", [
            "text_to_video", "image_to_video", "lora_support",
        ]),
        _entry("wan_2_1_1_3b", Runtime.WAN_GP, "t2v", [
            "text_to_video", "image_to_video",
        ]),
        _entry("scail2_14b_fast", Runtime.WAN_GP, "animate", [
            "fl2va", "lora_support",
        ]),
        _entry("flux_2_klein_9b", Runtime.DIFFUSERS, "t2i", [
            "text_to_image", "lora_support", "upscale",
        ]),
        _entry("qwen_image_edit", Runtime.DIFFUSERS, "edit", [
            "inpaint", "outpaint",
        ]),
        _entry("qwen3_tts", Runtime.COMFY, "speech", [
            "audio_generate", "text_to_speech",
        ]),
        _entry("kugelaudio", Runtime.COMFY, "speech", [
            "audio_generate", "text_to_speech",
        ]),
        _entry("ace_step_15_xl_sft", Runtime.COMFY, "music", [
            "audio_generate", "music_gen",
        ]),
        _entry("minimax_music3", Runtime.COMFY, "music", [
            "audio_generate", "music_gen",
        ]),
        _entry("mmaudio", Runtime.COMFY, "sfx", [
            "audio_generate",
        ]),
    ]


class CapabilityMatrix:
    """Matriz de capabilities declarativa com lookups por modelo/runtime/mode."""

    def __init__(self, entries: Optional[list[CapabilityEntry]] = None):
        self.entries = entries if entries is not None else default_catalog()

    def for_model(self, model_id: str) -> list[CapabilityEntry]:
        """Todas as entradas (runtime/mode) de um modelo."""
        return [e for e in self.entries if e.model_id == model_id]

    def for_model_runtime(
        self, model_id: str, runtime: Runtime
    ) -> list[CapabilityEntry]:
        """Entradas de um modelo em um runtime específico."""
        return [
            e for e in self.entries
            if e.model_id == model_id and e.runtime == runtime
        ]

    def check(
        self,
        model_id: str,
        runtime: Runtime,
        mode: str,
        capability: Capability,
    ) -> bool:
        """True se a capability existe para (modelo, runtime, modo).

        Modelo/runtime/mode desconhecidos retornam False (sem erro).
        """
        for e in self.entries:
            if (
                e.model_id == model_id
                and e.runtime == runtime
                and e.mode == mode
            ):
                return capability in e.capabilities
        return False

    def filter_by_capability(
        self, capability: Capability
    ) -> list[CapabilityEntry]:
        """Entradas que declaram a capability informada."""
        return [e for e in self.entries if capability in e.capabilities]

    def capabilities_for(
        self, model_id: str, runtime: Runtime, mode: str
    ) -> frozenset[Capability]:
        """Capabilities do trio (modelo, runtime, mode); vazio se inexistente."""
        for e in self.entries:
            if (
                e.model_id == model_id
                and e.runtime == runtime
                and e.mode == mode
            ):
                return e.capabilities
        return frozenset()

    # ------------------------------------------------------- agregados
    def model_ids(self) -> list[str]:
        """Lista ordenada de modelos catalogados."""
        return sorted({e.model_id for e in self.entries})

    def runtimes_for(self, model_id: str) -> list[str]:
        """Runtimes distintos de um modelo (ordem estável)."""
        seen: list[str] = []
        for e in self.for_model(model_id):
            if e.runtime.value not in seen:
                seen.append(e.runtime.value)
        return seen

    def summary_for_model(self, model_id: str) -> dict[str, Any]:
        """Agregado por modelo: runtimes, modos e união de capabilities."""
        entries = self.for_model(model_id)
        caps: set[Capability] = set()
        for e in entries:
            caps |= e.capabilities
        return {
            "model_id": model_id,
            "runtimes": self.runtimes_for(model_id),
            "modes": [e.mode for e in entries],
            "capabilities": sorted(c.value for c in caps),
        }

    def annotate_catalog(
        self, installed_model_ids: Iterable[str]
    ) -> list[dict[str, Any]]:
        """Soma ``in_catalog`` a cada modelo (integração com o catálogo real).

        Permite à UI anunciar badge só para modelos instalados e sinalizar
        capacidades declaradas para modelos ausentes do catálogo (divergência
        matriz vs. runtime real, spec §2.1).
        """
        installed = {str(m) for m in installed_model_ids}
        out: list[dict[str, Any]] = []
        for model_id in self.model_ids():
            summary = self.summary_for_model(model_id)
            summary["in_catalog"] = model_id in installed
            out.append(summary)
        return out


# ------------------------------------------------------------------
# Persistência atômica (app/capabilities_matrix.json)
# ------------------------------------------------------------------

def save_matrix_atomic(
    matrix: CapabilityMatrix, path: str | os.PathLike[str]
) -> Path:
    """Grava a matriz versionada de forma atômica (temp + rename)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": CAPABILITY_SCHEMA_VERSION,
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
    fd, tmp = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise
    return path


def load_matrix(path: str | os.PathLike[str]) -> CapabilityMatrix:
    """Lê a matriz persistida; ``schema_version`` desconhecida avisa."""
    path = Path(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != CAPABILITY_SCHEMA_VERSION:
        warnings.warn(
            f"capabilities schema_version={payload.get('schema_version')!r} "
            "desconhecida; lendo como legado",
            stacklevel=2,
        )
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


# ------------------------------------------------------------------
# Singleton de acesso (lido por router e UI)
# ------------------------------------------------------------------

def default_matrix_path() -> Path:
    """``app/capabilities_matrix.json`` (spec 37 §2.1)."""
    return Path(__file__).resolve().parent.parent / "capabilities_matrix.json"


_matrix_singleton: Optional[CapabilityMatrix] = None
_matrix_lock = threading.Lock()


def get_capability_matrix() -> CapabilityMatrix:
    """Matriz process-wide: arquivo versionado se existir, senão default."""
    global _matrix_singleton
    with _matrix_lock:
        if _matrix_singleton is None:
            path = default_matrix_path()
            if path.is_file():
                _matrix_singleton = load_matrix(path)
            else:
                _matrix_singleton = CapabilityMatrix()
        return _matrix_singleton


def set_capability_matrix(matrix: CapabilityMatrix) -> None:
    """Define o singleton (usado por testes e pela UI ao recarregar)."""
    global _matrix_singleton
    with _matrix_lock:
        _matrix_singleton = matrix


def reset_capability_matrix_singleton() -> None:
    """Zera o singleton; o próximo ``get_capability_matrix`` recarrega."""
    global _matrix_singleton
    with _matrix_lock:
        _matrix_singleton = None


__all__ = [
    "CAPABILITY_SCHEMA_VERSION",
    "Capability",
    "Runtime",
    "CapabilityEntry",
    "CapabilityMatrix",
    "default_catalog",
    "save_matrix_atomic",
    "load_matrix",
    "default_matrix_path",
    "get_capability_matrix",
    "set_capability_matrix",
    "reset_capability_matrix_singleton",
]
