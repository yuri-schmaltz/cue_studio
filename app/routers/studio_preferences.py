"""Durable Studio preferences and model visibility HTTP routes.

The runtime supplies server_config and server_config_filename. No model
imports, global runtime lookup or GPU initialization occurs in this router.
"""
from __future__ import annotations

import json
import os
import threading

from fastapi import APIRouter, HTTPException, Request


def build_studio_preferences_router(wgp) -> APIRouter:
    router = APIRouter()
    _MODEL_VISIBILITY_CONFIG_KEY = "cue_studio_model_visibility"
    _MODEL_VISIBILITY_WRITE_LOCK = threading.RLock()
    _H3_WINDOW_OVERRIDES_CONFIG_KEY = "cue_studio_h3_window_overrides"
    _STUDIO_PREFERENCES_CONFIG_KEY = "cue_studio_studio_preferences"


    def _normalize_studio_model_map(values, *, field_name):
        if values is None:
            return {}
        if not isinstance(values, dict):
            raise ValueError(f"{field_name} must be an object.")
        normalized = {}
        for raw_key, raw_model in values.items():
            if not isinstance(raw_key, str) or not isinstance(raw_model, str):
                raise ValueError(f"{field_name} entries must be strings.")
            key = raw_key.strip()
            model = raw_model.strip()
            if not key or len(key) > 50 or len(model) > 200:
                raise ValueError(f"A {field_name} entry is invalid.")
            if model:
                normalized[key] = model
        if len(normalized) > 20:
            raise ValueError(f"Too many {field_name} entries.")
        return normalized


    def _normalize_studio_preferences(values, current=None):
        """Validate the small, non-project Studio state that survives restarts.

        Prompt text, seeds, LoRAs, uploaded paths, and other job inputs are
        intentionally excluded. This record only remembers navigation/model
        choices and the two opt-in H3 acceleration switches.
        """
        if values is None:
            values = {}
        if not isinstance(values, dict):
            raise ValueError("Studio preferences must be an object.")
        normalized = dict(current or {})

        choices = {
            "generation_mode": {"image", "video", "audio", "avatar"},
            "studio_video_workflow": {
                "frames", "references", "extend", "blend", "retake",
                "prompt_edit", "outpaint", "repaint", "recast", "upscale",
                "film_grain",
            },
            "studio_image_workflow": {
                "generate", "inpaint", "outpaint", "upscale",
            },
            "audio_sub_mode": {"speech", "music", "sfx", "mixer", "revoice"},
        }
        for key, allowed in choices.items():
            if key not in values:
                continue
            value = values.get(key)
            if not isinstance(value, str) or value not in allowed:
                raise ValueError(f"{key} is invalid.")
            normalized[key] = value

        for key in ("selected_model_per_mode", "selected_model_per_audio_sub_mode"):
            if key in values:
                normalized[key] = _normalize_studio_model_map(
                    values.get(key), field_name=key,
                )

        if "h3_optimizations" in values:
            raw_h3 = values.get("h3_optimizations")
            if not isinstance(raw_h3, dict):
                raise ValueError("h3_optimizations must be an object.")
            override_attention = raw_h3.get("override_attention", "")
            cache_type = raw_h3.get("skip_steps_cache_type", "")
            if override_attention not in ("", "sol", "sla", "sdpa"):
                raise ValueError("override_attention is invalid.")
            if cache_type not in ("", "first_block"):
                raise ValueError("skip_steps_cache_type is invalid.")
            h3 = {
                "override_attention": override_attention,
                "skip_steps_cache_type": cache_type,
            }
            if "skip_steps_multiplier" in raw_h3:
                try:
                    multiplier = float(raw_h3["skip_steps_multiplier"])
                except (TypeError, ValueError) as error:
                    raise ValueError("skip_steps_multiplier must be numeric.") from error
                if not 0 <= multiplier <= 1:
                    raise ValueError("skip_steps_multiplier must be between 0 and 1.")
                h3["skip_steps_multiplier"] = multiplier
            if "skip_steps_start_step_perc" in raw_h3:
                try:
                    warmup = float(raw_h3["skip_steps_start_step_perc"])
                except (TypeError, ValueError) as error:
                    raise ValueError("skip_steps_start_step_perc must be numeric.") from error
                if not 0 <= warmup <= 100:
                    raise ValueError("skip_steps_start_step_perc must be between 0 and 100.")
                h3["skip_steps_start_step_perc"] = warmup
            normalized["h3_optimizations"] = h3

        return normalized


    def _studio_preferences_response():
        raw = wgp.server_config.get(_STUDIO_PREFERENCES_CONFIG_KEY)
        configured = isinstance(raw, dict) and bool(raw)
        try:
            preferences = _normalize_studio_preferences(raw or {})
        except ValueError:
            configured = False
            preferences = {}
        return {"configured": configured, **preferences}


    def _persist_model_visibility_config():
        """Backward-compatible wrapper for the original visibility writer."""
        _persist_server_config()


    def _normalize_h3_window_overrides(values):
        if values is None:
            return {}
        if not isinstance(values, dict):
            raise ValueError("H3 window overrides must be an object.")
        normalized = {}
        for raw_key, raw_frames in values.items():
            if not isinstance(raw_key, str):
                raise ValueError("H3 window override keys must be strings.")
            key = raw_key.strip()
            if not key or len(key) > 300 or "::" not in key:
                raise ValueError("An H3 window override key is invalid.")
            try:
                frames = int(raw_frames)
            except (TypeError, ValueError) as error:
                raise ValueError("H3 window override values must be integers.") from error
            if frames < 1 or frames > 345:
                raise ValueError("H3 window override values must be between 1 and 345 frames.")
            normalized[key] = frames
        if len(normalized) > 500:
            raise ValueError("Too many H3 window overrides.")
        return normalized


    def _h3_window_overrides_response():
        raw = wgp.server_config.get(_H3_WINDOW_OVERRIDES_CONFIG_KEY, {})
        try:
            overrides = _normalize_h3_window_overrides(raw)
        except ValueError:
            overrides = {}
        return {"overrides": overrides}


    def _normalize_model_visibility_ids(values):
        """Return a stable, de-duplicated list of persisted model identifiers."""
        if not isinstance(values, list):
            raise ValueError("Model visibility must be a list.")
        normalized = []
        seen = set()
        for value in values:
            if not isinstance(value, str):
                raise ValueError("Model visibility entries must be strings.")
            model_type = value.strip()
            if not model_type or model_type in seen:
                continue
            if len(model_type) > 200:
                raise ValueError("A model identifier is too long.")
            seen.add(model_type)
            normalized.append(model_type)
        if len(normalized) > 5000:
            raise ValueError("Too many model visibility entries.")
        return normalized


    def _model_visibility_response():
        raw = wgp.server_config.get(_MODEL_VISIBILITY_CONFIG_KEY)
        configured = isinstance(raw, dict) and isinstance(
            raw.get("enabled_models"), list,
        )
        if not configured:
            return {
                "configured": False,
                "enabled_models": [],
                "initialized_mature_models": [],
                "defaults_version": 0,
            }
        try:
            enabled_models = _normalize_model_visibility_ids(
                raw.get("enabled_models", []),
            )
            initialized_mature_models = _normalize_model_visibility_ids(
                raw.get("initialized_mature_models", []),
            )
        except ValueError:
            return {
                "configured": False,
                "enabled_models": [],
                "initialized_mature_models": [],
                "defaults_version": 0,
            }
        try:
            defaults_version = max(0, int(raw.get("defaults_version", 0)))
        except (TypeError, ValueError):
            defaults_version = 0
        return {
            "configured": True,
            "enabled_models": enabled_models,
            "initialized_mature_models": initialized_mature_models,
            "defaults_version": defaults_version,
        }


    def _persist_server_config():
        """Atomically persist Cue Studio UI preferences across changing ports."""
        config_path = os.path.abspath(wgp.server_config_filename)
        temp_path = (
            f"{config_path}.{os.getpid()}.{threading.get_ident()}.tmp"
        )
        with _MODEL_VISIBILITY_WRITE_LOCK:
            try:
                with open(temp_path, "w", encoding="utf-8") as handle:
                    json.dump(wgp.server_config, handle, indent=4)
                os.replace(temp_path, config_path)
            finally:
                if os.path.isfile(temp_path):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass


    @router.get("/api/v1/model-visibility")
    def get_model_visibility():
        """Return the server-persisted model selector whitelist."""
        return _model_visibility_response()


    @router.put("/api/v1/model-visibility")
    async def update_model_visibility(request: Request):
        """Persist model visibility independently of the browser's origin."""
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(
                status_code=400,
                detail="Model visibility payload must be an object.",
            )
        try:
            enabled_models = _normalize_model_visibility_ids(
                body.get("enabled_models"),
            )
            initialized_mature_models = _normalize_model_visibility_ids(
                body.get("initialized_mature_models", []),
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        try:
            defaults_version = max(0, int(body.get("defaults_version", 0)))
        except (TypeError, ValueError) as error:
            raise HTTPException(
                status_code=400,
                detail="defaults_version must be an integer.",
            ) from error

        with _MODEL_VISIBILITY_WRITE_LOCK:
            wgp.server_config[_MODEL_VISIBILITY_CONFIG_KEY] = {
                "enabled_models": enabled_models,
                "initialized_mature_models": initialized_mature_models,
                "defaults_version": defaults_version,
            }
            _persist_model_visibility_config()
            return _model_visibility_response()


    @router.get("/api/v1/h3-window-overrides")
    def get_h3_window_overrides():
        """Return durable H3 model/resolution native-pass preferences."""
        return _h3_window_overrides_response()


    @router.put("/api/v1/h3-window-overrides")
    async def update_h3_window_overrides(request: Request):
        """Persist H3 native-pass preferences independently of browser origin."""
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(
                status_code=400,
                detail="H3 window override payload must be an object.",
            )
        try:
            overrides = _normalize_h3_window_overrides(body.get("overrides"))
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        with _MODEL_VISIBILITY_WRITE_LOCK:
            wgp.server_config[_H3_WINDOW_OVERRIDES_CONFIG_KEY] = overrides
            _persist_server_config()
            return _h3_window_overrides_response()


    @router.get("/api/v1/studio-preferences")
    def get_studio_preferences():
        """Return workflow preferences that should survive Cue Studio restarts."""
        return _studio_preferences_response()


    @router.put("/api/v1/studio-preferences")
    async def update_studio_preferences(request: Request):
        """Merge and persist non-project Studio preferences across web origins."""
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(
                status_code=400,
                detail="Studio preferences payload must be an object.",
            )
        current = wgp.server_config.get(_STUDIO_PREFERENCES_CONFIG_KEY, {})
        try:
            preferences = _normalize_studio_preferences(body, current=current)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        with _MODEL_VISIBILITY_WRITE_LOCK:
            wgp.server_config[_STUDIO_PREFERENCES_CONFIG_KEY] = preferences
            _persist_server_config()
            return _studio_preferences_response()


    return router
