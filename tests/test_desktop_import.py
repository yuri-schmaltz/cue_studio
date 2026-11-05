import json
from pathlib import Path
import pytest
from app.desktop_import import import_workspace


def test_import_preserves_source_and_references_models_and_projects(tmp_path):
    source, data = tmp_path / 'legacy', tmp_path / 'desktop'
    source.mkdir()
    config = source / 'wgp_config.json'
    content = json.dumps({'save_path': 'outputs', 'checkpoints_paths': ['ckpts'],
                          'services': {'projects_root_path': 'projects'}})
    config.write_text(content)
    (data / 'config').mkdir(parents=True)
    target = data / 'config/wgp_config.json'
    target.write_text('{"theme":"dark"}')
    report = import_workspace(source, data)
    restored = json.loads(target.read_text())
    assert restored['checkpoints_paths'] == [str(source / 'ckpts')]
    assert restored['services']['projects_root_path'] == str(source / 'projects')
    assert restored['theme'] == 'dark'
    assert json.loads(Path(report['backup']).read_text()) == {'theme': 'dark'}
    assert config.read_text() == content


def test_invalid_import_does_not_replace_settings(tmp_path):
    (tmp_path / 'wgp_config.json').write_text('{"checkpoints_paths":"invalid"}')
    with pytest.raises(ValueError):
        import_workspace(tmp_path, tmp_path / 'data')
    assert not (tmp_path / 'data/config/wgp_config.json').exists()
