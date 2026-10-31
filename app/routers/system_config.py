"""Router de System Config e Hardware (/api/v1/system-config, /api/v1/system-detect, /api/v1/system-stats).

Gerenciamento de configurações do sistema, detecção de hardware, auto-tune e métricas em tempo real.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request

_log = logging.getLogger("cue_studio.routers.system_config")


def build_system_config_router(
    wgp_instance: Any,
    app_version: str,
    *,
    web_push_service: Any = None,
) -> APIRouter:
    router = APIRouter(tags=["system-config"])
    wgp = wgp_instance

    def _get_linked_model_folders():
        from shared.utils.files_locator import is_external_root

        paths = wgp.server_config.get("checkpoints_paths") or []
        return [p for p in paths[1:] if isinstance(p, str) and is_external_root(p)]

    def _apply_linked_model_folders(folders):
        from shared.utils.files_locator import is_external_root

        if not isinstance(folders, list):
            raise HTTPException(
                status_code=400, detail="model_folders must be a list of folder paths"
            )
        existing = wgp.server_config.get("checkpoints_paths") or []
        primary = (
            existing[0]
            if existing and isinstance(existing[0], str) and existing[0].strip()
            else "ckpts"
        )
        primary_n = os.path.normcase(os.path.normpath(os.path.abspath(primary)))
        normalized = []
        seen = set()
        for p in folders:
            if not isinstance(p, str) or not p.strip():
                raise HTTPException(status_code=400, detail=f"Invalid folder entry: {p!r}")
            cleaned = p.strip().strip('"').strip("'").strip()
            ap = os.path.normpath(os.path.abspath(cleaned))
            if not os.path.isdir(ap):
                raise HTTPException(status_code=400, detail=f"Folder does not exist: {ap}")
            if not is_external_root(ap):
                raise HTTPException(
                    status_code=400,
                    detail=f"Folder is inside the Cue Studio install (already searched): {ap}",
                )
            ap_n = os.path.normcase(ap)
            if ap_n == primary_n:
                raise HTTPException(
                    status_code=400, detail=f"Folder is the primary download root: {ap}"
                )
            if ap_n not in seen:
                seen.add(ap_n)
                normalized.append(ap)
        new_paths = [primary] + normalized + ["."]
        wgp.server_config["checkpoints_paths"] = new_paths
        wgp.fl.set_checkpoints_paths(new_paths)
        return normalized

    @router.get("/api/v1/system-config")
    def get_system_config():
        """Return system-level settings for the UI System tab."""
        cfg = wgp.server_config
        return {
            "app_version": app_version,
            "attention_mode": cfg.get("attention_mode", "auto"),
            "transformer_quantization": cfg.get("transformer_quantization", "int8"),
            "vae_config": cfg.get("vae_config", 0),
            "compile": cfg.get("compile", ""),
            "video_profile": cfg.get("video_profile", 2),
            "image_profile": cfg.get("image_profile", 2),
            "audio_profile": cfg.get("audio_profile", 3.5),
            "video_output_codec": cfg.get("video_output_codec", "libx264_8"),
            "image_output_codec": cfg.get("image_output_codec", "jpeg_95"),
            "enhancer_enabled": cfg.get("enhancer_enabled", 0),
            "prompt_enhancer_quantization": cfg.get(
                "prompt_enhancer_quantization", "quanto_int8"
            ),
            "attention_modes_available": list(wgp.attention_modes_supported),
            "host_notification_sound_enabled": bool(
                cfg.get("cue_studio_host_notification_sound_enabled", False)
            ),
            "host_notification_sound_volume": int(
                cfg.get("cue_studio_host_notification_sound_volume", 50)
            ),
            "vram_safety_coefficient": cfg.get(
                "vram_safety_coefficient", wgp.args.vram_safety_coefficient
            ),
            "model_folders": _get_linked_model_folders(),
        }

    @router.put("/api/v1/system-config")
    async def update_system_config(request: Request):
        """Update system-level settings. Accepts partial JSON body."""
        body = await request.json()

        ALLOWED_KEYS = {
            "attention_mode",
            "transformer_quantization",
            "vae_config",
            "compile",
            "video_profile",
            "image_profile",
            "audio_profile",
            "video_output_codec",
            "image_output_codec",
            "enhancer_enabled",
            "prompt_enhancer_quantization",
            "vram_safety_coefficient",
        }

        updated = {}
        if "model_folders" in body:
            updated["model_folders"] = _apply_linked_model_folders(body["model_folders"])

        if "host_notification_sound_enabled" in body:
            raw_enabled = body["host_notification_sound_enabled"]
            if not isinstance(raw_enabled, bool):
                raise HTTPException(
                    status_code=400,
                    detail="host_notification_sound_enabled must be true or false",
                )
            enabled = raw_enabled
            wgp.server_config["cue_studio_host_notification_sound_enabled"] = enabled
            updated["host_notification_sound_enabled"] = enabled

        if "host_notification_sound_volume" in body:
            try:
                volume = max(0, min(100, int(body["host_notification_sound_volume"])))
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=400,
                    detail="host_notification_sound_volume must be between 0 and 100",
                )
            wgp.server_config["cue_studio_host_notification_sound_volume"] = volume
            updated["host_notification_sound_volume"] = volume

        for key, value in body.items():
            if key in ALLOWED_KEYS:
                wgp.server_config[key] = value
                updated[key] = value

        if not updated:
            raise HTTPException(status_code=400, detail="No valid fields to update")

        with open(wgp.server_config_filename, "w", encoding="utf-8") as f:
            f.write(json.dumps(wgp.server_config, indent=4))

        if "attention_mode" in updated:
            wgp.attention_mode = updated["attention_mode"]
        if "vae_config" in updated:
            wgp.vae_config = updated["vae_config"]
        if "compile" in updated:
            wgp.compile = updated["compile"]
        if "vram_safety_coefficient" in updated:
            wgp.args.vram_safety_coefficient = float(updated["vram_safety_coefficient"])

        return {"status": "ok", "updated": updated}

    @router.post("/api/v1/notification-sound/test")
    async def test_host_notification_sound(request: Request):
        """Play a one-off test chime on the computer running Cue Studio."""
        try:
            body = await request.json()
        except Exception:
            body = {}
        try:
            volume = int(
                body.get(
                    "volume",
                    wgp.server_config.get("cue_studio_host_notification_sound_volume", 50),
                )
            )
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="volume must be between 0 and 100")
        volume = max(0, min(100, volume))
        try:
            wgp.notification_sound.notify_video_completion(volume=volume)
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"Unable to play notification sound: {exc}"
            )
        return {"status": "ok", "volume": volume}

    @router.get("/api/v1/model-folders/scan")
    def scan_model_folders():
        """Discover sibling Pinokio apps with a Wan2GP-style ckpts folder."""
        from shared.utils.files_locator import is_external_root

        app_dir = os.path.dirname(os.path.abspath(__file__))
        own_ckpts = os.path.normpath(os.path.join(app_dir, "..", "ckpts"))
        api_root = os.path.dirname(os.path.dirname(app_dir))
        linked = {os.path.normcase(os.path.normpath(p)) for p in _get_linked_model_folders()}

        candidates = []
        try:
            entries = list(os.scandir(api_root))
        except OSError:
            entries = []
        for entry in entries:
            if not entry.is_dir():
                continue
            ckpts = os.path.normpath(os.path.join(entry.path, "app", "ckpts"))
            if ckpts == own_ckpts or not os.path.isdir(ckpts):
                continue
            if not is_external_root(ckpts):
                continue
            file_count = 0
            dir_count = 0
            size_bytes = 0
            try:
                for f in os.scandir(ckpts):
                    if f.is_file():
                        file_count += 1
                        try:
                            size_bytes += f.stat().st_size
                        except OSError:
                            pass
                    elif f.is_dir():
                        dir_count += 1
            except OSError:
                continue
            if file_count == 0 and dir_count == 0:
                continue
            candidates.append({
                "app": entry.name,
                "path": ckpts,
                "files": file_count,
                "folders": dir_count,
                "size_gb": round(size_bytes / 1e9, 1),
                "linked": os.path.normcase(ckpts) in linked,
            })
        candidates.sort(key=lambda c: c["size_gb"], reverse=True)
        return {"candidates": candidates}

    @router.get("/api/v1/system-detect")
    def get_system_detect():
        """Return current hardware + the auto-tune recommendation for it."""
        from services.hardware_detect import detect_hardware
        from services.perf_recommend import recommend_settings

        hw = detect_hardware()
        rec = recommend_settings(hw)
        services = wgp.server_config.get("services", {})
        return {
            "hardware": hw,
            "recommended": rec,
            "auto_enabled": services.get("auto_performance", True),
        }

    @router.post("/api/v1/system-detect/apply")
    async def apply_system_detect():
        """Apply current hardware recommendations."""
        from services.hardware_detect import detect_hardware
        from services.perf_recommend import applied_keys, recommend_settings

        hw = detect_hardware()
        rec = recommend_settings(hw)

        profile_changed = False
        for key in applied_keys():
            if key in rec:
                old_value = wgp.server_config.get(key)
                new_value = rec[key]
                if old_value != new_value:
                    wgp.server_config[key] = new_value
                    if key.endswith("_profile"):
                        profile_changed = True

        services = wgp.server_config.setdefault("services", {})
        services["auto_performance"] = True
        services["auto_performance_applied"] = True

        with open(wgp.server_config_filename, "w", encoding="utf-8") as f:
            f.write(json.dumps(wgp.server_config, indent=4))

        if "attention_mode" in rec:
            wgp.attention_mode = rec["attention_mode"]
        if "vae_config" in rec:
            wgp.vae_config = rec["vae_config"]
        if "compile" in rec:
            wgp.compile = rec["compile"]
        if "vram_safety_coefficient" in rec:
            wgp.args.vram_safety_coefficient = float(rec["vram_safety_coefficient"])

        return {
            "status": "ok",
            "hardware": hw,
            "applied": {k: rec[k] for k in applied_keys() if k in rec},
            "label": rec.get("_recommendation_label", ""),
            "reason": rec.get("_recommendation_reason", ""),
            "profile_changed": profile_changed,
        }

    @router.get("/api/v1/system-stats")
    def get_system_stats_live():
        """Live hardware telemetry for the status indicators."""
        from services.live_stats import get_live_stats

        stats = get_live_stats()
        model_name = None
        model_type = None
        model_loaded = False
        try:
            model_type = getattr(wgp, "transformer_type", None)
            model_loaded = getattr(wgp, "wan_model", None) is not None
            if model_type:
                try:
                    md = wgp.get_model_def(model_type) or {}
                    model_name = md.get("name") or model_type
                except Exception:
                    model_name = model_type
        except Exception:
            pass

        stats["model"] = {
            "name": model_name,
            "model_type": model_type,
            "loaded": model_loaded,
        }
        return stats

    return router
