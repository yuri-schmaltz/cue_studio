"""A34 / R04 — CapabilityMatrix: lookup, check, filter e persistência."""
from __future__ import annotations

import json
import warnings

import pytest

from app.services.capability_matrix import (
    CAPABILITY_SCHEMA_VERSION,
    Capability,
    CapabilityEntry,
    CapabilityMatrix,
    Runtime,
    default_catalog,
    load_matrix,
    save_matrix_atomic,
)


def test_catalog_has_14_models_including_key_ones():
    matrix = CapabilityMatrix()
    expected = {
        "minimax_h3_omni_pruned",
        "ltx25_distilled",
        "wan_2_1_1_3b",
        "qwen3_tts",
        "ace_step_15_xl_sft",
    }
    got = {e.model_id for e in matrix.entries}
    assert len(matrix.entries) == 14
    assert expected <= got


def test_check_true_for_declared_capability():
    matrix = CapabilityMatrix()
    assert matrix.check(
        "minimax_h3_omni_pruned", Runtime.WAN_GP, "t2v",
        Capability.AUDIO_GENERATE,
    )


def test_check_false_for_undeclared_capability():
    matrix = CapabilityMatrix()
    assert not matrix.check(
        "ltx25_distilled", Runtime.WAN_GP, "t2v", Capability.AUDIO_GENERATE,
    )


def test_check_false_for_unknown_model():
    matrix = CapabilityMatrix()
    assert not matrix.check(
        "fake_model", Runtime.WAN_GP, "t2v", Capability.TEXT_TO_VIDEO,
    )


def test_check_false_for_wrong_mode():
    matrix = CapabilityMatrix()
    # minimax_h3_omni_pruned só declara modo "t2v".
    assert not matrix.check(
        "minimax_h3_omni_pruned", Runtime.WAN_GP, "i2v",
        Capability.TEXT_TO_VIDEO,
    )


def test_filter_music_gen_returns_two_entries():
    matrix = CapabilityMatrix()
    music = matrix.filter_by_capability(Capability.MUSIC_GEN)
    assert {e.model_id for e in music} == {
        "ace_step_15_xl_sft", "minimax_music3",
    }


def test_filter_lora_support_spans_families():
    matrix = CapabilityMatrix()
    lora = matrix.filter_by_capability(Capability.LORA_SUPPORT)
    models = {e.model_id for e in lora}
    assert {
        "minimax_h3_omni_pruned",
        "ltx25_distilled",
        "scail2_14b_fast",
        "flux_2_klein_9b",
    } <= models


def test_capabilities_for_unknown_returns_empty():
    matrix = CapabilityMatrix()
    assert matrix.capabilities_for("fake", Runtime.WAN_GP, "t2v") == frozenset()


def test_for_model_runtime_filters():
    matrix = CapabilityMatrix()
    entries = matrix.for_model_runtime("qwen3_tts", Runtime.COMFY)
    assert len(entries) == 1
    assert entries[0].mode == "speech"
    assert matrix.for_model_runtime("qwen3_tts", Runtime.WAN_GP) == []


def test_default_catalog_matches_persisted_file():
    """O arquivo versionado em app/ bate com o catálogo embutido."""
    from app.services.capability_matrix import default_matrix_path

    path = default_matrix_path()
    assert path.is_file()
    loaded = load_matrix(path)
    assert len(loaded.entries) == len(default_catalog())
    assert {e.model_id for e in loaded.entries} == {
        e.model_id for e in default_catalog()
    }


def test_save_load_round_trip_preserves_entries(tmp_path):
    path = tmp_path / "caps.json"
    matrix = CapabilityMatrix()
    save_matrix_atomic(matrix, path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["schema_version"] == CAPABILITY_SCHEMA_VERSION
    loaded = load_matrix(path)
    assert len(loaded.entries) == len(matrix.entries)


def test_load_unknown_schema_version_warns_but_reads(tmp_path):
    path = tmp_path / "caps.json"
    save_matrix_atomic(CapabilityMatrix(), path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["schema_version"] = "2.0"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        loaded = load_matrix(path)
    assert len(loaded.entries) == 14
    assert any("schema_version" in str(w.message) for w in caught)


def test_save_matrix_atomic_leaves_no_temp_files(tmp_path):
    path = tmp_path / "caps.json"
    save_matrix_atomic(CapabilityMatrix(), path)
    assert not [p for p in tmp_path.iterdir() if p.suffix == ".tmp"]


def test_summary_and_catalog_annotation():
    matrix = CapabilityMatrix()
    summary = matrix.summary_for_model("ltx25_distilled")
    assert summary["runtimes"] == ["wan_gp"]
    assert summary["modes"] == ["t2v"]
    assert "text_to_video" in summary["capabilities"]
    assert "outpaint" in summary["capabilities"]

    annotated = matrix.annotate_catalog({"ltx25_distilled", "wan_2_2_5b"})
    by_model = {m["model_id"]: m for m in annotated}
    assert by_model["ltx25_distilled"]["in_catalog"] is True
    assert by_model["minimax_h3_omni_pruned"]["in_catalog"] is False


def test_spec_capability_list_is_complete():
    """Toda capability da spec 37 §2.1 existe no enum."""
    spec_caps = [
        "text_to_video", "image_to_video", "first_last_frame", "extend",
        "audio_input", "audio_generate", "multi_window", "lora_support",
        "quantization", "controlnet", "upscale", "outpaint", "inpaint",
        "ref2v", "fl2va",
    ]
    enum_values = {c.value for c in Capability}
    assert set(spec_caps) <= enum_values


def test_custom_entries_matrix():
    entries = [
        CapabilityEntry(
            "custom_model", Runtime.COMFY, "speech",
            frozenset({Capability.AUDIO_GENERATE}),
        ),
    ]
    matrix = CapabilityMatrix(entries)
    assert matrix.check("custom_model", Runtime.COMFY, "speech", Capability.AUDIO_GENERATE)
    assert matrix.model_ids() == ["custom_model"]
