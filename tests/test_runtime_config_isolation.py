"""Tests must never persist preferences into the developer's wgp_config.json."""
from pathlib import Path


def test_launch_configuration_is_redirected_before_import():
    import launch
    path = Path(launch.wgp.server_config_filename).resolve()
    developer_config = Path(__file__).resolve().parents[1] / 'app/wgp_config.json'
    assert path != developer_config
    import os
    assert os.environ.get('CUE_CONFIG_DIR')
