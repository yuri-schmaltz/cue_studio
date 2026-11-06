import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from services import director_pipeline as pipeline


def test_nested_pipeline_is_listed_loaded_and_keeps_workspace(tmp_path):
    folder=tmp_path/'my-project/.director/abc12345'
    folder.mkdir(parents=True)
    state={'pipeline_id':'abc12345','status':'completed','workspace':'my-project','clips':[],'output_files':[]}
    path=folder/'_director_pipeline_abc12345.json'
    path.write_text(json.dumps(state))
    assert pipeline._find_pipeline_file(str(tmp_path),'abc12345')==str(path)
    assert pipeline.load_pipeline_state(str(tmp_path),'abc12345')['workspace']=='my-project'
    assert pipeline.list_pipeline_states(str(tmp_path))[0]['workspace']=='my-project'
    assert pipeline.load_pipeline_state(str(tmp_path/'my-project'),'abc12345')['pipeline_id']=='abc12345'


def test_legacy_layout_and_path_isolation(tmp_path):
    folder=tmp_path/'legacy';folder.mkdir()
    (folder/'_director_pipeline_old.json').write_text(json.dumps({'pipeline_id':'old','status':'completed','clips':[]}))
    assert pipeline.load_pipeline_state(str(tmp_path),'old')['pipeline_id']=='old'
    assert pipeline._find_pipeline_file(str(tmp_path),'../../outside') is None
    linked=tmp_path/'linked';linked.symlink_to(folder,target_is_directory=True)
    assert str(linked) not in pipeline._pipeline_directories(str(tmp_path))


def test_editor_resolves_nested_media_only_in_selected_workspace(tmp_path):
    import pytest
    from services.editor_projects import resolve_editor_asset, EditorProjectError
    folder=tmp_path/'my-project/.director/abc12345';folder.mkdir(parents=True)
    video=folder/'clip.mp4';video.write_bytes(b'media fixture')
    asset={'name':'clip.mp4','origin':'output','workspace':'my-project'}
    assert resolve_editor_asset(asset,save_root=str(tmp_path),workspace='my-project',uploads_root=str(tmp_path/'uploads'))==str(video)
    with pytest.raises(EditorProjectError):
        resolve_editor_asset({**asset,'workspace':'another-project'},save_root=str(tmp_path),workspace='another-project',uploads_root=str(tmp_path/'uploads'))
