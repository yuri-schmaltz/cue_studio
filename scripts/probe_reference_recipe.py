#!/usr/bin/env python3
"""Render selected reference-film probes through real jobs with strict receipts.

Use a new output directory for changed parameters. Completed source receipts
are reused only when both the request and artifact SHA-256 match exactly.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.reference_acceptance import file_hash
from app.services.reference_generation import ReferenceGenerationClient
from app.services.reference_recipe import load_visual_recipe, video_request
from app.services.reference_visuals import ReferenceVisuals


def reuse_receipt(source: Path, destination: Path, request: dict, output_root: Path) -> bool:
    if destination.exists() or not source.is_file():
        return False
    receipt = json.loads(source.read_text())
    if receipt.get('status') != 'completed' or receipt.get('request') != request:
        return False
    artifact = Path(receipt.get('artifact', '')).resolve()
    if not artifact.is_relative_to(output_root) or not artifact.is_file() or file_hash(artifact) != receipt.get('sha256'):
        raise ValueError(f'Completed source receipt has invalid artifact: {source}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--recipe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-receipts', type=Path, required=True)
    parser.add_argument('--stages', required=True, help='character,location,S06-image,S06-keyframe-33-image,S06-end-image,S06-video,...')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    recipe = load_visual_recipe(args.recipe, args.output.resolve() / 'recipe-used.json')
    root = Path(config['server_output_dir']).resolve()
    receipts = args.output.resolve() / 'receipts'
    client = ReferenceGenerationClient(config['base_url'], root, receipts,
                                       token=os.environ.get('CUE_F2_TOKEN', ''), timeout=config.get('job_timeout', 7200))
    image_params = {**config['image'], 'negative_prompt': recipe['negative']['image'],
                    'generation_mode': 'image', 'image_mode': 1, 'video_length': 1}

    def generate(label, request, extensions):
        reuse_receipt(args.source_receipts / (label + '.json'), receipts / (label + '.json'), request, root)
        print(f'[probe] {label}', flush=True)
        result = client.generate(label, request, extensions)
        print(f'[probe] completed {label}: {result}', flush=True)
        return result

    def existing_image(label, request, extensions):
        path = receipts / (label + '.json')
        receipt = json.loads(path.read_text())
        artifact = Path(receipt.get('artifact', '')).resolve()
        if (receipt.get('status') != 'completed' or receipt.get('request') != request
                or not artifact.is_relative_to(root) or not artifact.is_file()
                or file_hash(artifact) != receipt.get('sha256')):
            raise ValueError(f'Invalid probe image receipt: {path}; recipe, artifact and SHA must match')
        return artifact

    options = {'character_seed': config.get('character_anchor_seed', 99)}
    live = ReferenceVisuals(recipe, image_params, generate, **options)
    existing = ReferenceVisuals(recipe, image_params, existing_image, **options)
    video_batch_open = False
    for stage in args.stages.split(','):
        stage = stage.strip()
        if stage in {'character', 'location'}:
            stage = 'anchor-' + stage
        if stage in live.nodes:
            artifact = live.resolve(stage)
            print(f'[probe] resolved {stage}: {artifact}', flush=True)
            video_batch_open = False
            continue
        if not stage.endswith('-video') or stage[:-len('-video')] not in recipe['shots']:
            raise ValueError(f'Unknown probe stage: {stage}')
        shot = stage[:-len('-video')]
        path, end = existing.image(shot), existing.end(shot)
        keyframes = existing.keyframes(shot)
        request = video_request(config['video'], recipe['negative']['video'],
                                recipe['style'], recipe['shots'][shot]['motion'], path, end, keyframes)
        if not video_batch_open:
            client.request('/api/v1/system/release-model', {})
            video_batch_open = True
        generate(stage, request, {'.mp4', '.mkv', '.webm'})


if __name__ == '__main__':
    main()
