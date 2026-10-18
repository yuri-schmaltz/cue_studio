"""Testes de integração do cross-family continuity (A25b / R10)."""

from __future__ import annotations

from app.services.cross_family_continuity import (
    ContinuationStrategy,
    ContinuityRegistry,
    ModelFamily,
    PreviousShotOutput,
    StoryBibleRefs,
    BlockingContract,
    detect_family,
    create_default_registry,
    resolve_continuity,
    H3Adapter,
    H3OmniAdapter,
    LTXAdapter,
    LTX25Adapter,
    WanAdapter,
    HunyuanAdapter,
    IndependentFallbackAdapter,
)


def test_detect_family():
    assert detect_family("minimax_h3_omni_pruned") == ModelFamily.H3_OMNI
    assert detect_family("minimax_h3_first_last") == ModelFamily.H3
    assert detect_family("ltx25_distilled") == ModelFamily.LTX25
    assert detect_family("ltx2_3b") == ModelFamily.LTX
    assert detect_family("wan_2_2_5b") == ModelFamily.WAN
    assert detect_family("hunyuan_video") == ModelFamily.HUNYUAN
    assert detect_family("unknown_model") == ModelFamily.UNKNOWN


def test_create_default_registry():
    reg = create_default_registry()
    assert reg.has(ModelFamily.H3)
    assert reg.has(ModelFamily.H3_OMNI)
    assert reg.has(ModelFamily.LTX)
    assert reg.has(ModelFamily.LTX25)
    assert reg.has(ModelFamily.WAN)
    assert reg.has(ModelFamily.HUNYUAN)
    assert reg.has(ModelFamily.UNKNOWN)


def test_resolve_continuity_no_previous():
    strategy = resolve_continuity("wan_2_2_5b", None)
    assert strategy.mode == "independent"
    assert strategy.confidence == 0.0


def test_h3_picture_n_reference():
    prev = PreviousShotOutput(shot_id="s1", picture_n_index=3)
    strategy = resolve_continuity("minimax_h3", prev)
    assert strategy.mode == "picture_n_reference"
    assert strategy.confidence == 0.9
    assert strategy.adapter_family == ModelFamily.H3


def test_h3_omni_subject_binding():
    prev = PreviousShotOutput(
        shot_id="s1",
        subject_bindings=(("char_ana", "asset_1"),),
        speaker_bindings=(("spk_1", "asset_2"),),
    )
    strategy = resolve_continuity("minimax_h3_omni", prev)
    assert strategy.mode == "subject_binding"
    assert strategy.confidence == 0.95
    assert strategy.adapter_family == ModelFamily.H3_OMNI


def test_ltx_first_last_frame():
    prev = PreviousShotOutput(shot_id="s1", last_frame_path="/tmp/last.png")
    strategy = resolve_continuity("ltx2_3b", prev)
    assert strategy.mode == "first_last_frame"
    assert strategy.confidence == 0.8
    assert strategy.adapter_family == ModelFamily.LTX


def test_wan_lora_continuity():
    prev = PreviousShotOutput(shot_id="s1", lora_refs=("lora_1",))
    strategy = resolve_continuity("wan_2_2_5b", prev)
    assert strategy.mode == "picture_n_reference"
    assert strategy.confidence == 0.7
    assert strategy.adapter_family == ModelFamily.WAN


def test_hunyuan_independent():
    prev = PreviousShotOutput(shot_id="s1", last_frame_path="/tmp/last.png")
    strategy = resolve_continuity("hunyuan_video", prev)
    assert strategy.mode == "independent"
    assert strategy.adapter_family == ModelFamily.HUNYUAN


def test_unknown_fallback():
    prev = PreviousShotOutput(shot_id="s1", last_frame_path="/tmp/last.png")
    strategy = resolve_continuity("unknown_model", prev)
    assert strategy.mode == "independent"
    assert strategy.adapter_family == ModelFamily.UNKNOWN


def test_strategy_validate():
    s = ContinuationStrategy(mode="independent", payload={}, confidence=0.5, adapter_family=ModelFamily.H3)
    s.validate()  # não deve levantar

    try:
        ContinuationStrategy(mode="invalid_mode", payload={}, confidence=0.5, adapter_family=ModelFamily.H3).validate()
        assert False, "deveria ter levantado"
    except ValueError:
        pass


def test_blocking_contract():
    contract = BlockingContract(
        subject_ids=("char_ana",),
        setting_id="room_a",
        object_state_match=(("obj_cup", "on_table"),),
        gaze_targets=(),
        wardrobe_versions=(("char_ana", "v1"),),
        requires_previous_frame=True,
        requires_first_frame=False,
    )
    assert contract.subject_ids == ("char_ana",)
    assert contract.requires_previous_frame is True


def test_previous_shot_output_frozen():
    prev = PreviousShotOutput(shot_id="s1", picture_n_index=3)
    assert prev.shot_id == "s1"
    assert prev.picture_n_index == 3
