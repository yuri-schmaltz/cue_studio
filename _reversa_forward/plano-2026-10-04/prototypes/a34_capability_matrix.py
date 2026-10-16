#!/usr/bin/env python3
"""Protótipo isolado de CapabilityMatrix (A34 / R04).

Valida `37-feature-a34-capability-matrix.md` sem importar de `app/`.

1. Capability enum + Runtime enum + CapabilityEntry + CapabilityMatrix.
2. Catálogo inicial com 14 modelos reais do Cue Studio v2.5.2.
3. Métodos `for_model`, `check`, `filter_by_capability`.
4. Persistência atômica em JSON.
5. 7 testes cobrindo: lookup, check, filtro, missing, round-trip,
   capability inexistente, modelo com capability parcial.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a34_capability_matrix.py
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
from typing import Optional


# ---------------------------------------------------------------------------
# 1. Modelo de dados
# ---------------------------------------------------------------------------

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
    mode: str  # "t2v" | "i2v" | "fl2v" | "t2i" | "edit" | "speech" | "music" | "sfx" | "animate"
    capabilities: frozenset


# ---------------------------------------------------------------------------
# 2. Catálogo inicial
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# 3. Persistência
# ---------------------------------------------------------------------------

def save_matrix_atomic(matrix: CapabilityMatrix, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": "1.0",
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
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "1.0":
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


# ---------------------------------------------------------------------------
# 4. Suíte de testes
# ---------------------------------------------------------------------------

def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_catalog_has_expected_models() -> bool:
    m = CapabilityMatrix()
    expected = {"minimax_h3_omni_pruned", "ltx25_distilled", "wan_2_1_1_3b", "qwen3_tts", "ace_step_15_xl_sft"}
    got = {e.model_id for e in m.entries}
    return check(
        "catalog: contém 14 modelos incluindo 5 chaves",
        len(m.entries) == 14 and expected.issubset(got),
        f"entries={len(m.entries)}, got={sorted(got)}",
    )


def test_check_returns_true_for_declared_capability() -> bool:
    m = CapabilityMatrix()
    return check(
        "check: minimax_h3_omni_pruned tem audio_generate em t2v",
        m.check("minimax_h3_omni_pruned", Runtime.WAN_GP, "t2v", Capability.AUDIO_GENERATE),
    )


def test_check_returns_false_for_undeclared_capability() -> bool:
    m = CapabilityMatrix()
    return check(
        "check: ltx25_distilled NÃO tem audio_generate",
        not m.check("ltx25_distilled", Runtime.WAN_GP, "t2v", Capability.AUDIO_GENERATE),
    )


def test_check_returns_false_for_unknown_model() -> bool:
    m = CapabilityMatrix()
    return check(
        "check: modelo inexistente retorna False",
        not m.check("fake_model", Runtime.WAN_GP, "t2v", Capability.TEXT_TO_VIDEO),
    )


def test_filter_by_capability_returns_matches() -> bool:
    m = CapabilityMatrix()
    music = m.filter_by_capability(Capability.MUSIC_GEN)
    return check(
        "filter_by_capability: music_gen retorna 2 entradas (ace_step, minimax_music3)",
        len(music) == 2 and {e.model_id for e in music} == {"ace_step_15_xl_sft", "minimax_music3"},
        f"got={sorted(e.model_id for e in music)}",
    )


def test_capabilities_for_unknown_returns_empty() -> bool:
    m = CapabilityMatrix()
    return check(
        "capabilities_for: modelo desconhecido retorna frozenset vazio",
        m.capabilities_for("fake", Runtime.WAN_GP, "t2v") == frozenset(),
    )


def test_save_load_roundtrip() -> bool:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "caps.json"
        m = CapabilityMatrix()
        save_matrix_atomic(m, path)
        loaded = load_matrix(path)
        same = len(loaded.entries) == len(m.entries)
        return check(
            "save/load: round-trip atômico preserva entries",
            same,
            f"original={len(m.entries)}, loaded={len(loaded.entries)}",
        )


def test_partial_capability_filter() -> bool:
    """Capacidade compartilhada por múltiplos modelos retorna todos."""
    m = CapabilityMatrix()
    lora = m.filter_by_capability(Capability.LORA_SUPPORT)
    has_minimax = any(e.model_id == "minimax_h3_omni_pruned" for e in lora)
    has_ltx = any(e.model_id == "ltx25_distilled" for e in lora)
    has_scail = any(e.model_id == "scail2_14b_fast" for e in lora)
    has_flux = any(e.model_id == "flux_2_klein_9b" for e in lora)
    return check(
        "filter: lora_support retorna minimax+ltx+scail+flux",
        has_minimax and has_ltx and has_scail and has_flux,
        f"matches={[e.model_id for e in lora if e.model_id in {'minimax_h3_omni_pruned', 'ltx25_distilled', 'scail2_14b_fast', 'flux_2_klein_9b'}]}",
    )


def main() -> int:
    print("== A34 CapabilityMatrix prototype ==")
    tests = [
        test_catalog_has_expected_models,
        test_check_returns_true_for_declared_capability,
        test_check_returns_false_for_undeclared_capability,
        test_check_returns_false_for_unknown_model,
        test_filter_by_capability_returns_matches,
        test_capabilities_for_unknown_returns_empty,
        test_save_load_roundtrip,
        test_partial_capability_filter,
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