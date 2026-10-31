import pytest
from scripts.normalize_lock_hashes import normalize_hashes


def test_nightly_index_keeps_only_the_strong_artifact_hash():
    text = 'pkg==1 \\\n    --hash=md5:' + 'a' * 32 + ' \\\n    --hash=sha256:' + 'b' * 64 + '\n'
    result = normalize_hashes(text)
    assert '--hash=md5' not in result
    assert '--hash=sha256:' + 'b' * 64 in result
    assert result.startswith('pkg==1')


def test_md5_only_dependency_is_rejected():
    with pytest.raises(ValueError, match='SHA-256'):
        normalize_hashes('pkg==1 \\\n    --hash=md5:' + 'a' * 32 + '\n')
