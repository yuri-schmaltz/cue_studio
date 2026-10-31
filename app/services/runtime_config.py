"""Pure defaults and completion for existing/partial runtime configuration."""
from __future__ import annotations

from copy import deepcopy


def default_runtime_config(*, checkpoints_paths, lora_root, low_memory_profile):
    return {
        "attention_mode" : "auto",
        "transformer_types": [],
        "transformer_quantization": "int8",
        "text_encoder_quantization" : "int8",
        "lm_decoder_engine": "",
        "save_path": "outputs",
        "image_save_path": "outputs",
        "compile" : "",
        "metadata_type": "metadata",
        "boost" : 1,
        "enable_int8_kernels": 1,
        "clear_file_list" : 5,
        "enable_4k_resolutions": 0,
        "max_reserved_loras": -1,
        "vae_config": 0,
        "profile" : low_memory_profile,
        "video_profile": low_memory_profile,
        "image_profile": low_memory_profile,
        "audio_profile": 3.5,
        "preload_model_policy": [],
        "UI_theme": "default",
        "checkpoints_paths": checkpoints_paths,
        "loras_root": lora_root,
        "save_queue_if_crash": 1,
		"queue_color_scheme": "pastel",
        "model_hierarchy_type": 1,
        "mmaudio_mode": 0,
        "mmaudio_persistence": 1,
        "rife_version": "v4",
        "prompt_enhancer_quantization": "quanto_int8",
        "prompt_enhancer_temperature": 0.6,
        "prompt_enhancer_top_p": 0.9,
        "prompt_enhancer_randomize_seed": True,
        "audio_save_path": "outputs",
    }


def complete_runtime_config(config: dict, defaults: dict) -> dict:
    """Fill missing keys without replacing user values or sharing mutable defaults."""
    result = {**deepcopy(defaults), **deepcopy(config)}
    for key in ("image_save_path", "audio_save_path"):
        if key not in config:
            result[key] = result["save_path"]
    for key in ("video_profile", "image_profile"):
        if key not in config:
            result[key] = result["profile"]
    return result
