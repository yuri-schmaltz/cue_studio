"""Requested story runtime must survive model shot/window preferences."""
import math
from unittest.mock import Mock

import pytest

from services.director.planners.short_film import ShortFilmPlanner
from types import SimpleNamespace


def planner():
    p = ShortFilmPlanner()
    p._call_llm_json = Mock(return_value=[{
        'title': 'Cube', 'scene_goal': 'A cube turns slightly',
        'duration_sec': 20, 'video_prompt': 'A red cube turns slightly.',
        'image_prompt': 'A red cube on a table.', 'window_prompts': [],
    }])
    return p


@pytest.mark.parametrize('seconds', [3, 8, 19])
def test_brief_story_uses_one_native_length_shot(seconds):
    p = planner()
    plan = p.plan(story_description='A red cube turns slightly. No dialogue.',
                  target_duration=seconds, fps=24, frames_steps=8,
                  frames_minimum=9, video_model='ltx2_22B_distilled_1_1')
    assert len(plan.shots) == 1
    assert abs(plan.total_duration_sec - seconds) <= 4 / 24
    assert plan.shots[0].window_prompts == []
    schema = p._call_llm_json.call_args.kwargs['json_schema']
    assert schema['minItems'] == schema['maxItems'] == 1
    assert schema['items']['properties']['window_prompts']['maxItems'] == 0
    assert schema['items']['properties']['duration_sec']['const'] == plan.total_duration_sec


def test_brief_story_rejects_extra_shots_instead_of_truncating_content():
    p = planner()
    p._call_llm_json.return_value *= 3
    with pytest.raises(ValueError, match='exactly one shot'):
        p.plan(story_description='Cube', target_duration=3, frames_minimum=9)


@pytest.mark.parametrize('seconds', [0, -1, math.nan, math.inf])
def test_invalid_runtime_rejected_before_llm(seconds):
    p = planner()
    with pytest.raises(ValueError, match='positive finite'):
        p.plan(story_description='Cube', target_duration=seconds)
    p._call_llm_json.assert_not_called()


def test_unrepresentable_runtime_rejected_before_llm():
    p = planner()
    with pytest.raises(ValueError, match='minimum'):
        p.plan(story_description='Cube', target_duration=1, fps=24, frames_minimum=41)
    p._call_llm_json.assert_not_called()


def test_regular_plan_cannot_silently_exceed_runtime():
    p = planner()
    p._plan_story_driven = Mock(return_value=([
        SimpleNamespace(duration_sec=100)], 'Cube'))
    with pytest.raises(ValueError, match='duration budget'):
        p.plan(story_description='Cube', target_duration=30, video_model='ltx2')


def test_audio_timing_is_not_replaced_by_story_runtime():
    p = planner()
    p._plan_audio_driven = Mock(return_value=[
        SimpleNamespace(duration_sec=30)])
    plan = p.plan(clips=[{'start': 0, 'end': 30}], target_duration=3)
    assert plan.total_duration_sec == 30


def test_brief_story_does_not_discard_window_content():
    p = planner()
    p._call_llm_json.return_value[0]['window_prompts'] = ['Extra story content']
    with pytest.raises(ValueError, match='without windows'):
        p.plan(story_description='Cube', target_duration=3)


def test_brief_story_rejects_unperformable_dialogue():
    p = planner()
    p._call_llm_json.return_value[0]['dialogue_beats'] = [{'spoken_text': 'word ' * 20}]
    with pytest.raises(ValueError, match='dialogue exceeds'):
        p.plan(story_description='A person speaking', target_duration=3)


def test_brief_video_only_omits_still_image_contract():
    p = planner()
    plan = p.plan(story_description='Cube', target_duration=3,
                  shot_image_policy='prompt_only', video_model='ltx2')
    assert plan.shots[0].image_prompt is None
    schema = p._call_llm_json.call_args.kwargs['json_schema']
    assert 'image_prompt' not in schema['items']['properties']


def test_preflight_preserves_brief_story_native_schedule():
    from services.director.preflight import build_preflight_report
    report = build_preflight_report(
        planned_clips=[{'duration_sec': 73 / 24}], fps=25,
        frames_minimum=17, latent_size=8, quantize_frames=True,
        model_def={'director_video_strategy': 'rolling_window'})
    assert report['total_frames'] == 73


def test_video_submission_preserves_three_second_plan(monkeypatch, tmp_path):
    from services import director_pipeline as pipeline
    fake = SimpleNamespace(
        get_model_def=lambda model: {'fps': 25, 'frames_minimum': 17, 'frames_steps': 8, 'sliding_window': True},
        get_model_min_frames_and_step=lambda model: (17, 8, 8),
        save_path=str(tmp_path),
    )
    monkeypatch.setattr(pipeline, '_wgp', fake)
    monkeypatch.setattr(pipeline, '_validate_director_models', lambda *a, **k: None)
    monkeypatch.setattr(pipeline, '_director_video_execution_profile', lambda *a, **k: {})
    submit = Mock(return_value=['clip.mp4'])
    monkeypatch.setattr(pipeline, '_submit_and_wait', submit)
    pipeline._run_video_generation('duration-test', {
        'video_model': 'ltx2', 'seamless': False, 'auto_mode': True,
        'pipeline_type': 'short_film_story', 'shot_image_guidance': 'prompt_only',
    }, [{'video_prompt': 'Cube turns'}], [{'duration_sec': 73 / 24}], [], out_dir=str(tmp_path))
    assert submit.call_args.args[0]['per_clip_frames'] == [73]
    assert submit.call_args.args[0]['video_length'] == 73
