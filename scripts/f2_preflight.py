#!/usr/bin/env python3
"""Smoke-check the F2 validation config: one job per modality, real backend.

Runs against the live Studio backend using the same ReferenceGenerationClient
the official F2 test uses, so a passing preflight means the config is
executable. Writes to a scratch directory that must not be the real
validation_dir, so approved evidence is never touched.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.reference_generation import ReferenceGenerationClient

CONFIG = Path(os.environ["CUE_F2_CONFIG"])
SCRATCH = Path(os.environ.get("CUE_F2_SCRATCH", CONFIG.parent / "preflight"))

VISUAL_STYLE = (
    "Cinematic 3D animated short film, simple clean geometric shapes, "
    "soft studio lighting, consistent physical geometry. No text or subtitles."
)


def main() -> int:
    config = json.loads(CONFIG.read_text())
    SCRATCH.mkdir(parents=True, exist_ok=True)
    client = ReferenceGenerationClient(
        config["base_url"],
        Path(config["server_output_dir"]),
        SCRATCH / "receipts",
        token=os.environ.get("CUE_F2_TOKEN", ""),
        timeout=config.get("job_timeout", 3600),
    )
    # Stages let a rerun reuse the artifacts of the earlier ones from the
    # same scratch directory instead of paying for them again.
    stages = {
        name.strip()
        for name in os.environ.get("CUE_F2_STAGES", "speech,image,refs,video,sfx").split(",")
        if name.strip()
    }

    artifacts: dict[str, Path] = {}

    def reuse(label: str) -> Path | None:
        receipt = SCRATCH / "receipts" / (label + ".json")
        if receipt.is_file():
            data = json.loads(receipt.read_text())
            artifact = data.get("artifact")
            if artifact and Path(artifact).is_file():
                return Path(artifact)
        return None

    if "speech" in stages:
        print("[preflight] -> preflight-speech", flush=True)
        artifacts["preflight-speech"] = client.generate("preflight-speech", {
            **config["speech"],
            "prompt": "Na oficina silenciosa, uma pequena descoberta.",
        }, {".wav", ".flac"})
        print(f"[preflight] OK preflight-speech: {artifacts['preflight-speech']}", flush=True)

    if "image" in stages:
        print("[preflight] -> preflight-image-anchor", flush=True)
        artifacts["preflight-image-anchor"] = client.generate("preflight-image-anchor", {
            **config["image"],
            "generation_mode": "image",
            "image_mode": 1,
            "video_length": 1,
            "prompt": VISUAL_STYLE + " A small friendly robot with three round lenses "
                      "for eyes and two arms, standing in a workshop.",
        }, {".png", ".jpg", ".jpeg", ".webp"})
        print(f"[preflight] OK preflight-image-anchor: {artifacts['preflight-image-anchor']}", flush=True)

    anchor = artifacts.get("preflight-image-anchor") or reuse("preflight-image-anchor")
    if "refs" in stages and anchor:
        print("[preflight] -> preflight-image-with-refs", flush=True)
        refs = client.generate("preflight-image-with-refs", {
            **config["image"],
            "generation_mode": "image",
            "image_mode": 1,
            "video_length": 1,
            "prompt": VISUAL_STYLE + " The same robot places a matte red cube on a table.",
            "image_refs": [str(anchor)],
            "video_prompt_type": "KI",
        }, {".png", ".jpg", ".jpeg", ".webp"})
        print(f"[preflight] OK preflight-image-with-refs: {refs}", flush=True)
    else:
        refs = reuse("preflight-image-with-refs")

    if "video" in stages and refs:
        print("[preflight] -> preflight-video", flush=True)
        video = client.generate("preflight-video", {
            **config["video"],
            "prompt": VISUAL_STYLE + " The robot turns toward the table.",
            "image_start": str(refs),
            "image_prompt_type": "S",
        }, {".mp4", ".mkv", ".webm"})
        print(f"[preflight] OK preflight-video: {video}", flush=True)
    else:
        video = reuse("preflight-video")

    if "sfx" in stages and video:
        print("[preflight] -> preflight-sfx", flush=True)
        sfx = client.generate("preflight-sfx", {
            **config["sfx"],
            "prompt": "soft mechanical hum",
            "video_guide": str(video),
        }, {".wav", ".flac", ".mp4"})
        print(f"[preflight] OK preflight-sfx: {sfx}", flush=True)

    print("[preflight] ALL REQUESTED MODALITIES OK", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
