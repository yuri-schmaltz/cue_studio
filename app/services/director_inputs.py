"""Validate explicit user inputs before dispatching or resuming inference."""
from __future__ import annotations

from pathlib import Path


def validate_director_inputs(params: dict) -> None:
    paths = []
    for key in ('audio_path', 'audio_vocals_path', 'reference_image_path', 'voice_reference'):
        if params.get(key):
            paths.append((key, params[key]))
    for key in ('character_ref_paths', 'location_ref_paths', 'prepared_clip_image_paths'):
        for index, value in enumerate(params.get(key) or []):
            if value:
                paths.append((f'{key}[{index}]', value))
    for index, reference in enumerate(params.get('minimax_h3_references') or []):
        if isinstance(reference, dict):
            for key in ('path', 'audio_path'):
                if reference.get(key):
                    paths.append((f'minimax_h3_references[{index}].{key}', reference[key]))
    for key, value in paths:
        if not isinstance(value, str) or not Path(value).is_file():
            raise ValueError(f'Missing Director input {key}: {value}. Restore or replace it before inference.')
