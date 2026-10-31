import hashlib
import json

import pytest
from scripts.probe_reference_recipe import reuse_receipt


def test_probe_reuses_only_identical_completed_requests(tmp_path):
    root = tmp_path / 'outputs'
    root.mkdir()
    artifact = root / 'image.png'
    artifact.write_bytes(b'existing rendered artifact')
    source = tmp_path / 'source.json'
    request = {'model_type': 'fixture', 'prompt': 'same request'}
    receipt = {'status': 'completed', 'request': request, 'artifact': str(artifact),
               'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()}
    source.write_text(json.dumps(receipt))
    destination = tmp_path / 'receipts' / 'probe.json'
    assert not reuse_receipt(source, destination, {**request, 'prompt': 'different'}, root)
    assert not destination.exists()
    assert reuse_receipt(source, destination, request, root)
    assert json.loads(destination.read_text()) == receipt
    # Existing evidence is never replaced, even when the source later differs.
    original = destination.read_bytes()
    source.write_text('{}')
    assert not reuse_receipt(source, destination, request, root)
    assert destination.read_bytes() == original


@pytest.mark.parametrize('outside', [False, True])
def test_probe_refuses_tampered_or_out_of_scope_artifacts(tmp_path, outside):
    root = tmp_path / 'outputs'
    root.mkdir()
    artifact = (tmp_path if outside else root) / 'image.png'
    artifact.write_bytes(b'artifact')
    request = {'model_type': 'fixture'}
    source = tmp_path / 'source.json'
    source.write_text(json.dumps({'status': 'completed', 'request': request,
                                 'artifact': str(artifact), 'sha256': '0' * 64}))
    with pytest.raises(ValueError, match='invalid artifact'):
        reuse_receipt(source, tmp_path / 'new.json', request, root)


@pytest.mark.parametrize('tampered_end', [False, True, 'request'])
def test_probe_conditions_video_on_verified_generated_end_frame(tmp_path, monkeypatch, tampered_end):
    import sys
    from scripts import probe_reference_recipe as probe

    root = tmp_path / 'outputs'
    root.mkdir()
    output = tmp_path / 'probe'
    requests = {}
    releases = []

    class Client:
        def __init__(self, base_url, output_root, receipts, **kwargs):
            self.receipts = receipts
            receipts.mkdir(parents=True)

        def generate(self, label, request, extensions):
            requests[label] = request
            artifact = root / (label + '.png')
            artifact.write_bytes(label.encode())
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            (self.receipts / (label + '.json')).write_text(json.dumps({
                'status': 'completed', 'artifact': str(artifact),
                'sha256': '0' * 64 if tampered_end is True and label == 'S09-end-image' else digest,
                'request': {**request, 'prompt': 'old recipe'} if tampered_end == 'request' and label == 'S09-end-image' else request,
            }))
            return artifact

        def request(self, path, body):
            releases.append(path)

    config = tmp_path / 'config.json'
    config.write_text(json.dumps({'base_url': 'http://fixture', 'server_output_dir': str(root),
                                  'image': {}, 'video': {}}))
    recipe = tmp_path / 'recipe.json'
    recipe.write_text(json.dumps({'style': 'Style.', 'location': 'Room.',
        'negative': {'image': 'negative', 'video': 'negative'},
        'shots': {'S09': {'image': 'Bulb off.', 'end_image': 'Same view, bulb on.', 'motion': 'Light up.'},
                  'S12': {'image': 'Same existing state.', 'image_source': 'S09-image',
                          'end_image_source': 'start', 'motion': 'Hold this state.'}}}))
    monkeypatch.setattr(probe, 'ReferenceGenerationClient', Client)
    monkeypatch.setattr(sys, 'argv', ['probe', '--config', str(config), '--recipe', str(recipe),
        '--output', str(output), '--source-receipts', str(tmp_path / 'sources'),
        '--stages', 'S09-image,S09-end-image,S09-video,S12-video'])
    if tampered_end:
        with pytest.raises(ValueError, match='Invalid probe image receipt'):
            probe.main()
        assert 'S09-video' not in requests
        assert releases == []
    else:
        probe.main()
        assert requests['S09-end-image']['image_refs'] == [str(root / 'S09-image.png')]
        assert requests['S09-video']['image_start'] == str(root / 'S09-image.png')
        assert requests['S09-video']['image_end'] == str(root / 'S09-end-image.png')
        assert requests['S09-video']['image_prompt_type'] == 'SE'
        assert requests['S12-video']['image_start'] == str(root / 'S09-image.png')
        assert requests['S12-video']['image_end'] == str(root / 'S09-image.png')
        assert 'S12-image' not in requests
        # One image-to-video transition; consecutive video jobs keep the
        # resident model rather than reloading it once per shot.
        assert releases == ['/api/v1/system/release-model']
