"""Testes de integração do modelo de música YuE (YuE v1, dois estágios).

Cobre o contrato do handler (`app/models/TTS/yue_handler.py`), as definições
de catálogo (`app/defaults/yue*.json`), a matriz de capacidades e o guia de
escrita de músicas — sem baixar pesos nem tocar a GPU.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.capability_matrix import (
    Capability,
    CapabilityMatrix,
    Runtime,
)
from models.TTS.yue_handler import family_handler

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
DEFAULTS_DIR = APP_ROOT / "defaults"
GUIDES_DIR = APP_ROOT / "services" / "llm_guides" / "music"


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _stage_files(handler_def: list[dict], folder: str) -> list[str]:
    """Arquivos declarados para uma pasta de destino específica.

    Uma pasta pode aparecer em várias entradas (o xcodecMini vem em nove
    grupos de arquivos), então todas as entradas são agregadas.
    """
    collected: list[str] = []
    for entry in handler_def:
        if folder in (entry.get("targetFolderList") or []):
            collected += [file for group in entry["fileList"] for file in group]
    return collected


def _source_files(handler_def: list[dict], target_folder: str, source_folder: str) -> list[str]:
    """Arquivos declarados para uma subpasta de origem dentro de uma pasta."""
    collected: list[str] = []
    for entry in handler_def:
        target_folders = entry.get("targetFolderList") or []
        source_folders = entry.get("sourceFolderList") or []
        file_groups = entry.get("fileList") or []
        for target, source, files in zip(target_folders, source_folders, file_groups):
            if target == target_folder and source == source_folder:
                collected += list(files)
    return collected


# --- Handler ---------------------------------------------------------------


def test_handler_exposes_yue_architecture():
    assert "yue" in family_handler.query_supported_types()
    assert family_handler.query_model_family() == "tts"


def test_model_def_is_audio_only_and_knows_yue_knobs():
    definition = family_handler.query_model_def("yue", {})
    assert definition["audio_only"] is True
    assert definition["image_outputs"] is False
    assert definition["no_negative_prompt"] is True
    assert definition["inference_steps"] is False
    assert definition["temperature"] is True
    # O Stage 1 é um LLM: o limite de tokens precisa ser alto.
    assert definition["yue_max_new_tokens"] >= 1000
    assert definition["yue_stage2_batch_size"] >= 1
    assert definition["yue_segment_duration"] >= 1


def test_model_def_enables_audio_prompt_only_when_asked():
    plain = family_handler.query_model_def("yue", {})
    assert "any_audio_prompt" not in plain

    icl = family_handler.query_model_def("yue", {"yue_audio_prompt": True})
    assert icl["any_audio_prompt"] is True
    assert icl["audio_prompt_choices"] is True
    assert icl["audio_prompt_type_sources"]["default"] == ""


def test_download_def_lists_the_real_weights():
    files = family_handler.query_model_files(None, "yue", {})
    assert isinstance(files, list) and files

    stage1 = _stage_files(files, "YuE-s1-7B-anneal-en-cot")
    # O Stage 1 é fragmentado: o loader do MMGP mescla os shards.
    assert "model-00001-of-00003.safetensors" in stage1
    assert "model-00002-of-00003.safetensors" in stage1
    assert "model-00003-of-00003.safetensors" in stage1
    assert "model.safetensors.index.json" in stage1
    assert "config.json" in stage1

    stage2 = _stage_files(files, "YuE-s2-1B-general")
    # O peso do Stage 2 vem do grupo "URLs2" do catálogo; a pasta guarda
    # apenas os arquivos de apoio.
    assert "config.json" in stage2
    assert "generation_config.json" in stage2
    assert "model.safetensors" not in stage2

    tokenizer = _stage_files(files, "mm_tokenizer_v0.2_hf")
    assert "tokenizer.model" in tokenizer

    xcodec = _stage_files(files, "xcodec_mini_infer")
    assert "vocoder.py" in xcodec
    assert "post_process_audio.py" in xcodec
    # O codec Mini traz o encoder final, os vocoders e as pastas auxiliares.
    final_ckpt = _source_files(files, "xcodec_mini_infer", "final_ckpt")
    assert "config.yaml" in final_ckpt
    assert "ckpt_00360000.pth" in final_ckpt
    decoders = _source_files(files, "xcodec_mini_infer", "decoders")
    assert "config.yaml" in decoders
    assert "decoder_131000.pth" in decoders
    assert "decoder_151000.pth" in decoders
    for folder in ("models", "quantization", "RepCodec", "descriptaudiocodec",
                   "vocos", "semantic_ckpts/hf_1_325000"):
        assert _source_files(files, "xcodec_mini_infer", folder) == []


def test_download_def_uses_the_icl_checkpoint_for_the_audio_variant():
    files = family_handler.query_model_files(None, "yue", {"yue_audio_prompt": True})
    folders = [folder for entry in files for folder in (entry.get("targetFolderList") or [])]
    assert "YuE-s1-7B-anneal-en-icl" in folders
    assert "YuE-s1-7B-anneal-en-cot" not in folders


# --- Validação de prompt ---------------------------------------------------


def test_validate_requires_lyrics_and_style():
    lyrics = "[Verse]\nHello"

    error = family_handler.validate_generative_prompt(
        "yue", {}, {"prompt": lyrics, "alt_prompt": "pop"}, ""
    )
    assert error and "Lyrics" in error

    error = family_handler.validate_generative_prompt(
        "yue", {}, {"prompt": lyrics, "alt_prompt": ""}, lyrics
    )
    assert error and "Genres" in error

    assert (
        family_handler.validate_generative_prompt(
            "yue", {}, {"prompt": lyrics, "alt_prompt": "pop"}, lyrics
        )
        is None
    )


def test_validate_rejects_audio_prompt_on_the_base_model():
    lyrics = "[Verse]\nHello"
    error = family_handler.validate_generative_prompt(
        "yue",
        {},
        {"prompt": lyrics, "alt_prompt": "pop", "audio_guide": "/tmp/ref.wav"},
        lyrics,
    )
    assert error and "ICL" in error


def test_validate_accepts_audio_prompt_on_the_icl_model():
    lyrics = "[Verse]\nHello"
    model_def = {"yue_audio_prompt": True}
    assert (
        family_handler.validate_generative_prompt(
            "yue",
            model_def,
            {
                "prompt": lyrics,
                "alt_prompt": "pop",
                "audio_prompt_type": "A",
                "audio_guide": "/tmp/ref.wav",
            },
            lyrics,
        )
        is None
    )

    error = family_handler.validate_generative_prompt(
        "yue",
        model_def,
        {"prompt": lyrics, "alt_prompt": "pop", "audio_prompt_type": "A"},
        lyrics,
    )
    assert error and "audio prompt" in error.lower()


def test_validate_rejects_inverted_audio_prompt_window():
    lyrics = "[Verse]\nHello"
    model_def = {"yue_audio_prompt": True}
    error = family_handler.validate_generative_prompt(
        "yue",
        model_def,
        {
            "prompt": lyrics,
            "alt_prompt": "pop",
            "audio_prompt_type": "A",
            "audio_guide": "/tmp/ref.wav",
            "yue_prompt_start_time": 30.0,
            "yue_prompt_end_time": 10.0,
        },
        lyrics,
    )
    assert error and "less than" in error


# --- Catálogo --------------------------------------------------------------


@pytest.mark.parametrize("model_type", ["yue", "yue_icl"])
def test_defaults_declare_a_usable_model(model_type: str):
    definition = _read_json(DEFAULTS_DIR / f"{model_type}.json")
    model = definition["model"]
    assert model["architecture"] == "yue"
    assert model["name"]
    assert model["description"]
    # Duas fontes de peso: Stage 1 (fragmentado) e Stage 2.
    assert model["URLs"] and model["URLs2"]
    assert model["URLs"] != model["URLs2"]
    # As URLs precisam do caminho /resolve/<revisão>/ para o downloader.
    assert "/resolve/main/" in model["URLs"][0]
    assert "/resolve/main/" in model["URLs2"][0]
    assert model["URLs2"][0].endswith("YuE-s2-1B-general/resolve/main/model.safetensors")
    # A letra é a fonte da verdade do catálogo: prompt = letra, alt_prompt = estilo.
    assert definition["prompt"].strip()
    assert definition["alt_prompt"].strip()
    assert definition["audio_prompt_type"] == ""


def test_icl_default_enables_the_audio_prompt_flag():
    definition = _read_json(DEFAULTS_DIR / "yue_icl.json")
    assert definition["model"]["yue_audio_prompt"] is True

    base = _read_json(DEFAULTS_DIR / "yue.json")
    assert "yue_audio_prompt" not in base["model"]


def test_yue_models_are_registered_in_the_wgp_family_handlers():
    source = (APP_ROOT / "wgp.py").read_text(encoding="utf-8")
    assert "models.TTS.yue_handler" in source


# --- Matriz de capacidades -------------------------------------------------


def test_capability_matrix_declares_yue_as_a_music_model():
    matrix = CapabilityMatrix()
    for model_id in ("yue", "yue_icl"):
        assert matrix.check(model_id, Runtime.WAN_GP, "music", Capability.MUSIC_GEN)
        assert matrix.check(model_id, Runtime.WAN_GP, "music", Capability.AUDIO_GENERATE)


def test_capability_matrix_json_file_is_in_sync():
    payload = _read_json(APP_ROOT / "capabilities_matrix.json")
    entries = {entry["model_id"]: entry for entry in payload["entries"]}
    assert "yue" in entries
    assert entries["yue"]["mode"] == "music"
    assert "music_gen" in entries["yue"]["capabilities"]


# --- Guia de escrita de músicas -------------------------------------------


@pytest.mark.parametrize("guide", ["song_writer_yue.md", "song_writer_yue_instrumental.md"])
def test_yue_song_writer_guides_exist(guide: str):
    text = (GUIDES_DIR / guide).read_text(encoding="utf-8")
    # O parser do backend espera exatamente estas duas seções.
    assert "[STYLE]" in text
    assert "[LYRICS]" in text
    # O YuE recebe tags separadas por vírgula, não uma frase.
    assert "comma separated" in text


def test_launch_wires_the_yue_guides():
    source = (APP_ROOT / "launch.py").read_text(encoding="utf-8")
    assert 'load_guide("music", "song_writer_yue")' in source
    assert 'load_guide("music", "song_writer_yue_instrumental")' in source


# --- Perfil de memória ------------------------------------------------------


def test_yue_defs_declare_their_own_memory_profile():
    """O planner de 7B do YuE precisa de RAM reservada para não arrastar.

    O perfil padrão de áudio do app (4.5) recarrega os pesos do disco a
    cada token e transforma um trecho de dois minutos em meia hora de
    espera. Os defs do YuE declaram o perfil 2 (HighRAM_LowVRAM), que
    mantém uma cópia em RAM e carrega só o que cabe na VRAM.
    """
    for name in ("yue.json", "yue_icl.json"):
        model = _read_json(DEFAULTS_DIR / name)["model"]
        assert model.get("memory_profile") == 2


def _import_wgp():
    """Importa o wgp com o mesmo bootstrap que o launch.py usa.

    O wgp faz parse de sys.argv e lê "defaults/*.json" relativo ao cwd,
    então o import direto dentro do pytest quebraria.
    """
    import os
    import sys

    previous_cwd = os.getcwd()
    previous_argv = sys.argv
    os.chdir(APP_ROOT)
    sys.argv = ["wgp.py", "--multiple-images"]
    try:
        import wgp  # importado aqui: o wgp puxa torch e leva alguns segundos
    finally:
        os.chdir(previous_cwd)
        sys.argv = previous_argv
    return wgp


def test_compute_profile_honours_the_model_declared_profile():
    wgp = _import_wgp()

    assert wgp.compute_profile(-1, "audio", model_type="yue") == 2
    assert wgp.compute_profile(-1, "audio", model_type="yue_icl") == 2
    # A escolha explícita do usuário sempre vence a declaração do modelo.
    assert wgp.compute_profile(4, "audio", model_type="yue") == 4
    # Modelos sem declaração seguem o padrão genérico do tipo de saída.
    assert wgp.compute_profile(-1, "audio") == wgp.get_default_profile("audio")


def test_yue_defs_declare_their_own_vram_budgets():
    """O planner de 7B só pode ser rápido com uma fatia dele na VRAM.

    O padrão do app deixa 100 MB do "transformer" residentes, o que serve
    para difusão de vídeo (o VRAM é para os latentes) mas obriga o LLM
    do YuE a transferring 12 GB a cada token gerado.
    """
    for name in ("yue.json", "yue_icl.json"):
        model = _read_json(DEFAULTS_DIR / name)["model"]
        budgets = model.get("vram_budgets", {})
        assert budgets.get("transformer") == "70%"
        assert budgets.get("transformer2") == "10%"


def test_yue_defs_request_enough_tokens_for_one_segment():
    """Um segmento de 6 s do YuE custa ~600 tokens no Stage 1.

    O Stage 1 emite dois tokens (um por codebook) por quadro de 50 fps.
    Abaixo disso o Stage 2 recebe uma matriz vazia e a geração quebra.
    """
    for name in ("yue.json", "yue_icl.json"):
        model = _read_json(DEFAULTS_DIR / name)["model"]
        assert model["yue_max_new_tokens"] >= 600
        assert model["yue_run_n_segments"] == 1
        assert model["yue_segment_duration"] == 6


def test_init_pipe_applies_the_model_vram_budgets():
    wgp = _import_wgp()

    pipe = {"transformer": object(), "transformer2": object()}
    kwargs = {"coTenantsMap": {}}
    profile = wgp.compute_profile(-1, "audio", model_type="yue")
    wgp.init_pipe(pipe, kwargs, profile, model_type="yue")

    budgets = kwargs["budgets"]
    assert budgets["transformer"] == "70%"
    assert budgets["transformer2"] == "10%"

    # Um modelo sem declaração mantém o orçamento genérico do app.
    plain_kwargs = {"coTenantsMap": {}}
    wgp.init_pipe(pipe, plain_kwargs, profile, model_type="wan_video")
    assert plain_kwargs["budgets"]["transformer"] == 100
