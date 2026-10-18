"""Testes de integração do serviço CapabilityMatrix (A34 / R04)."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

from app.services.capability_matrix import (
    Capability,
    CapabilityEntry,
    CapabilityMatrix,
    Runtime,
    get_capability_matrix,
    load_matrix,
    reset_capability_matrix_singleton,
    save_matrix_atomic,
)


def test_catalog_has_14_entries():
    m = CapabilityMatrix()
    assert len(m.entries) == 14


def test_check_declared_capability():
    m = CapabilityMatrix()
    assert m.check("minimax_h3_omni_pruned", Runtime.WAN_GP, "t2v", Capability.AUDIO_GENERATE) is True


def test_check_undeclared_capability():
    m = CapabilityMatrix()
    assert m.check("ltx25_distilled", Runtime.WAN_GP, "t2v", Capability.AUDIO_GENERATE) is False


def test_check_unknown_model():
    m = CapabilityMatrix()
    assert m.check("fake_model", Runtime.WAN_GP, "t2v", Capability.TEXT_TO_VIDEO) is False


def test_filter_by_capability():
    m = CapabilityMatrix()
    music = m.filter_by_capability(Capability.MUSIC_GEN)
    assert len(music) == 2
    assert {e.model_id for e in music} == {"ace_step_15_xl_sft", "minimax_music3"}


def test_capabilities_for_unknown():
    m = CapabilityMatrix()
    assert m.capabilities_for("fake", Runtime.WAN_GP, "t2v") == frozenset()


def test_save_load_roundtrip():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "caps.json"
        m = CapabilityMatrix()
        save_matrix_atomic(m, path)
        loaded = load_matrix(path)
        assert len(loaded.entries) == len(m.entries)


def test_for_model():
    m = CapabilityMatrix()
    entries = m.for_model("qwen3_tts")
    assert len(entries) == 1
    assert entries[0].runtime == Runtime.COMFY


def test_lora_support_filter():
    m = CapabilityMatrix()
    lora = m.filter_by_capability(Capability.LORA_SUPPORT)
    ids = {e.model_id for e in lora}
    assert "minimax_h3_omni_pruned" in ids
    assert "flux_2_klein_9b" in ids


def test_singleton_isolation(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_CACHE_DIR", str(tmp_path / "cache"))
    reset_capability_matrix_singleton()
    m = get_capability_matrix()
    assert m is not None
    assert len(m.entries) == 14
    reset_capability_matrix_singleton()
