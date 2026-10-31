from app.services.runtime_config import complete_runtime_config, default_runtime_config


def test_partial_config_boots_with_runtime_defaults():
    defaults = default_runtime_config(checkpoints_paths=["ckpts"], lora_root="loras", low_memory_profile=4)
    supplied = {"save_path": "/isolated", "profile": 3, "services": {"active_workspace": "film"}}
    result = complete_runtime_config(supplied, defaults)
    assert result["attention_mode"] == "auto"
    assert result["image_save_path"] == result["audio_save_path"] == "/isolated"
    assert result["image_profile"] == result["video_profile"] == 3
    assert result["services"] == supplied["services"]
    result["services"]["active_workspace"] = "other"
    result["checkpoints_paths"].append("new")
    assert supplied["services"]["active_workspace"] == "film"
    assert defaults["checkpoints_paths"] == ["ckpts"]


def test_explicit_per_mode_settings_are_preserved():
    defaults = default_runtime_config(checkpoints_paths=[], lora_root="loras", low_memory_profile=4)
    supplied = {"profile": 3, "image_profile": 2, "image_save_path": "/images", "attention_mode": "sdpa"}
    result = complete_runtime_config(supplied, defaults)
    assert all(result[key] == value for key, value in supplied.items())
