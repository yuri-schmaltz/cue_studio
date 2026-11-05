import hashlib
import importlib.util
import json
from pathlib import Path
import pytest
spec = importlib.util.spec_from_file_location('runtime_source', Path(__file__).resolve().parents[1] / 'app/runtime_source.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def package(source, text):
    source.mkdir(exist_ok=True)
    (source / 'launch.py').write_text(text)
    (source / 'runtime-code-manifest.json').write_text(json.dumps({'schema':1, 'files':{'launch.py':hashlib.sha256(text.encode()).hexdigest()}}))


def test_code_upgrade_without_dependency_changes_preserves_user_data(tmp_path):
    source, private = tmp_path / 'package', tmp_path / 'private'
    package(source, 'old')
    assert m.sync_source(source, private)
    (private / 'models').mkdir(); (private / 'models/weights.gguf').write_text('weights')
    (private / 'wgp_config.json').write_text('user settings')
    package(source, 'new code, same requirements')
    assert m.sync_source(source, private)
    assert (private / 'launch.py').read_text() == 'new code, same requirements'
    assert (private / 'models/weights.gguf').read_text() == 'weights'
    assert (private / 'wgp_config.json').read_text() == 'user settings'
    assert not m.sync_source(source, private)


def test_bad_source_checksum_does_not_replace_previous_source(tmp_path):
    source, private = tmp_path / 'package', tmp_path / 'private'
    package(source, 'old'); m.sync_source(source, private)
    package(source, 'new'); (source / 'launch.py').write_text('corrupt')
    with pytest.raises(ValueError, match='checksum'): m.sync_source(source, private)
    assert (private / 'launch.py').read_text() == 'old'
