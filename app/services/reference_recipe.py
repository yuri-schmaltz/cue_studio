"""Build real reference-film requests with explicit start/end conditioning."""
from pathlib import Path
import json
import math


def load_visual_recipe(source: Path, snapshot: Path, required_shots=None) -> dict:
    """Validate and freeze the exact recipe before any job is submitted."""
    raw = source.read_bytes()
    recipe = json.loads(raw)
    if not isinstance(recipe, dict) or not isinstance(recipe.get('style'), str):
        raise ValueError('A visual recipe requires a style and shot definitions')
    shots = recipe.get('shots')
    if not isinstance(shots, dict) or not shots:
        raise ValueError('A visual recipe requires shot definitions')
    if required_shots is not None and set(shots) != set(required_shots):
        raise ValueError('The visual recipe must cover exactly the reference-film shots')
    for shot_id, shot in shots.items():
        if not isinstance(shot, dict) or any(
            not isinstance(shot.get(key), str) or not shot[key].strip()
            for key in ('image', 'motion')
        ):
            raise ValueError(f'{shot_id}: image and motion prompts are required')
        if end_frame_source(shot) == 'generated' and not shot['end_image'].strip():
            raise ValueError(f'{shot_id}: end-image edit must be a nonempty prompt')
        if shot.get('camera') not in (None, 'locked', 'moving'):
            raise ValueError(f'{shot_id}: camera must be locked or moving')
        motion = shot.get('lateral_motion')
        if motion is not None:
            allowed = {'direction', 'min_travel_fraction', 'max_step_fraction', 'min_step_fraction'}
            if not isinstance(motion, dict) or set(motion) - allowed or not shot.get('keyframes'):
                raise ValueError(f'{shot_id}: lateral_motion requires keyframes and supported motion limits')
            if motion.get('direction', 'right') not in {'right', 'left'}:
                raise ValueError(f'{shot_id}: invalid lateral motion direction')
            for key in allowed - {'direction'}:
                if key in motion and (type(motion[key]) not in (int, float) or not 0 <= motion[key] <= 1):
                    raise ValueError(f'{shot_id}: motion limits must be fractions in [0, 1]')
    visual_dependencies(recipe)
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    try:
        with snapshot.open('xb') as handle:
            handle.write(raw)
    except FileExistsError:
        if snapshot.read_bytes() != raw:
            raise ValueError('The visual recipe changed; use a new validation directory')
    return recipe


def end_frame_source(shot: dict) -> str | None:
    """A stationary shot may condition its ending on its real start still."""
    source = shot.get('end_image_source')
    prompt = shot.get('end_image')
    if prompt is not None and not isinstance(prompt, str):
        raise ValueError('An end-image edit must be a prompt string')
    if source is not None:
        if not isinstance(source, str) or (source != 'start' and not source.endswith('-image')):
            raise ValueError('end_image_source must be start or a shot image reference')
        if prompt:
            raise ValueError('Choose a start-frame endpoint or an end-image edit, not both')
        return 'start' if source == 'start' else 'reference'
    return 'generated' if prompt else None


def visual_dependencies(recipe: dict, character_shots=None) -> dict:
    """Reject missing/cyclic states before any model job is submitted."""
    shots = recipe['shots']
    characters = set(shots) - {'S01', 'S09', 'S12'} if character_shots is None else set(character_shots)
    graph = {'anchor-character': [], 'anchor-location': []}
    for shot_id, shot in shots.items():
        image = shot_id + '-image'
        source = shot.get('image_source')
        if source is not None and (not isinstance(source, str) or not source.endswith('-image')):
            raise ValueError(f'{shot_id}: image_source must reference an image state')
        graph[image] = [source] if source else ['anchor-location'] + (['anchor-character'] if shot_id in characters else [])
        end_source = end_frame_source(shot)
        if end_source:
            graph[shot_id + '-end-image'] = [shot['end_image_source']] if end_source == 'reference' else [image]
        frames = shot.get('keyframes', [])
        if not isinstance(frames, list):
            raise ValueError(f'{shot_id}: keyframes must be a list')
        previous = 1
        for frame in frames:
            if not isinstance(frame, dict) or type(frame.get('frame')) is not int or frame['frame'] <= previous:
                raise ValueError(f'{shot_id}: keyframes require increasing one-based positions after frame 1')
            previous = frame['frame']
            source = frame.get('source')
            prompt = frame.get('prompt')
            if source is not None:
                if source not in ('start', 'end') or prompt:
                    raise ValueError(f'{shot_id}: choose a start/end keyframe source or an edit prompt')
                dependency = image if source == 'start' else shot_id + '-end-image'
            else:
                if not isinstance(prompt, str) or not prompt.strip():
                    raise ValueError(f'{shot_id}: a generated keyframe requires an edit prompt')
                dependency = image
            graph[f"{shot_id}-keyframe-{frame['frame']}-image"] = [dependency]
    visiting, visited = set(), set()

    def visit(label):
        if label not in graph:
            raise ValueError(f'Missing visual reference: {label}')
        if label in visiting:
            raise ValueError(f'Cyclic visual reference: {label}')
        if label in visited:
            return
        visiting.add(label)
        for dependency in graph[label]:
            visit(dependency)
        visiting.remove(label)
        visited.add(label)

    for label in graph:
        visit(label)
    return graph


def end_frame_request(image_params: dict, style: str, prompt: str, start: Path) -> dict:
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("An end frame requires an explicit edit prompt")
    return {
        **image_params, "prompt": style + " " + prompt,
        "generation_mode": "image", "image_mode": 1, "video_length": 1,
        "image_refs": [str(start)], "video_prompt_type": "KI",
    }


def video_request(video_params: dict, negative: str, style: str, motion: str,
                  start: Path, end: Path | None = None, keyframes=None) -> dict:
    request = {
        **video_params, "negative_prompt": negative, "prompt": style + " " + motion,
        "image_start": str(start), "image_prompt_type": "SE" if end else "S",
    }
    # Recipe references are authoritative; do not inherit a stale end frame
    # from machine-level configuration when the shot has no final keyframe.
    request.pop("image_end", None)
    padding = request.pop("end_frame_padding", 0)
    if type(padding) is not int or padding < 0:
        raise ValueError("end_frame_padding must be a nonnegative integer")
    if end is not None:
        request["image_end"] = str(end)
        if padding:
            original = int(request["video_length"])
            request["video_length"] = original + padding
            # Preserve an existing multi-window plan. For a shot fitting in
            # one window, keep that property after adding native trim budget.
            window = request.get("sliding_window_size")
            if window is not None and int(window) >= original:
                request["sliding_window_size"] = max(int(window), original + padding)
    if keyframes:
        previous = 1
        for position, path in keyframes:
            if type(position) is not int or not previous < position < int(request['video_length']):
                raise ValueError('Keyframe positions must increase inside the generated video')
            previous = position
        strength = request.get('injection_strength', 1.0)
        if type(strength) not in (int, float) or not math.isfinite(strength) or not 0 < strength <= 1:
            raise ValueError('Keyframe injection strength must be in (0, 1]')
        mode = request.get('keyframe_inject_mode', 'replace')
        if mode not in ('replace', 'additive'):
            raise ValueError('Invalid keyframe injection mode')
        request.update(video_prompt_type='KFI', image_refs=[str(path) for _, path in keyframes],
                       frames_positions=' '.join(str(position) for position, _ in keyframes),
                       injection_strength=strength, keyframe_inject_mode=mode)
    return request
