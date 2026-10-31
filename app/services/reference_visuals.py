"""Resolve real image jobs and shared visual states for reference-film shots.

The callback either generates a job or reads an existing verified receipt.
References reuse that job's artifact; they never invent alias job receipts.
"""
from pathlib import Path

from .reference_recipe import end_frame_request, end_frame_source, visual_dependencies

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}


class ReferenceVisuals:
    def __init__(self, recipe, image_params, resolve_job, *, character_seed=99, character_shots=None):
        self.recipe = recipe
        self.params = image_params
        self.resolve_job = resolve_job
        self.character_seed = character_seed
        self.character_shots = (set(recipe['shots']) - {'S01', 'S09', 'S12'}
                                if character_shots is None else set(character_shots))
        self.dependencies = visual_dependencies(recipe, self.character_shots)
        self.cache = {}
        self.nodes = {f'anchor-{kind}': ('anchor', kind) for kind in ('character', 'location')}
        for shot_id, shot in recipe['shots'].items():
            self.nodes[shot_id + '-image'] = ('image', shot_id)
            if end_frame_source(shot):
                self.nodes[shot_id + '-end-image'] = ('end', shot_id)
            for keyframe in shot.get('keyframes', []):
                self.nodes[f"{shot_id}-keyframe-{keyframe['frame']}-image"] = ('keyframe', shot_id, keyframe)

    def image(self, shot):
        return self.resolve(shot + '-image')

    def end(self, shot):
        return self.resolve(shot + '-end-image') if end_frame_source(self.recipe['shots'][shot]) else None

    def keyframes(self, shot):
        return [(frame['frame'], self.resolve(f"{shot}-keyframe-{frame['frame']}-image"))
                for frame in self.recipe['shots'][shot].get('keyframes', [])]

    def resolve(self, label):
        if label in self.cache:
            return self.cache[label]
        if label not in self.nodes:
            raise ValueError(f'Unknown visual reference: {label}')
        node = self.nodes[label]
        kind, name = node[:2]
        if kind == 'anchor':
            request = {**self.params, 'prompt': self.recipe['style'] + ' ' + self.recipe[name]}
            if name == 'character':
                request['seed'] = self.character_seed
        else:
            shot = self.recipe['shots'][name]
            alias = None
            if kind == 'image':
                alias = shot.get('image_source')
                if not alias:
                    guides = [self.resolve('anchor-location')]
                    if name in self.character_shots:
                        guides.insert(0, self.resolve('anchor-character'))
                    request = {**self.params, 'prompt': self.recipe['style'] + ' ' + shot['image'],
                               'image_refs': [str(path) for path in guides], 'video_prompt_type': 'KI'}
            elif kind == 'end':
                source = end_frame_source(shot)
                if source == 'start':
                    alias = name + '-image'
                elif source == 'reference':
                    alias = shot['end_image_source']
                else:
                    request = end_frame_request(self.params, self.recipe['style'], shot['end_image'], self.image(name))
            else:
                frame = node[2]
                if frame.get('source'):
                    alias = name + ('-image' if frame['source'] == 'start' else '-end-image')
                else:
                    request = end_frame_request(self.params, self.recipe['style'], frame['prompt'], self.image(name))
            if alias:
                artifact = self.resolve(alias)
                self.cache[label] = artifact
                return artifact
        artifact = Path(self.resolve_job(label, request, IMAGE_EXTENSIONS))
        self.cache[label] = artifact
        return artifact
