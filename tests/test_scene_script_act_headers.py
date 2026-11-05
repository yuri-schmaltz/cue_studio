import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from services.director.scene_script import parse_scene_script, reconcile_scene_script


def test_pipe_headers_cover_all_acts_without_borrowing_next_act_times():
    boundaries = [0, 10, 21, 32, 43, 54, 66, 78, 89, 101, 112, 124, 136, 148, 160, 172, 184, 196, 208, 220, 232, 244, 255]
    clock = lambda sec: f'{sec // 60:02}:{sec % 60:02}'
    text = []
    for i, (start, end) in enumerate(zip(boundaries, boundaries[1:]), 1):
        if i in [1, 7, 13, 19]:
            act_end = {1:66, 7:136, 13:208, 19:255}[i]
            text += [f'Ato {(i - 1) // 6 + 1} — Story', f'{clock(start)}–{clock(act_end)} | Overview']
        text += [f'Cena {i:02} | {clock(start)}–{clock(end)} — Shot {i}', 'A musician performs.']
    script = parse_scene_script('\n\n'.join(text))
    assert [(s.start, s.end) for s in script.scenes] == list(zip(boundaries, boundaries[1:]))
    assert script.scenes[5].title == 'Shot 6'
    assert 'Ato 2' not in script.scenes[5].body
    report = reconcile_scene_script(script, 255)
    assert report.status == 'full_track'
    assert report.anchored_scene_count == 22
    assert report.uncovered_seconds == 0
    assert not report.gaps
