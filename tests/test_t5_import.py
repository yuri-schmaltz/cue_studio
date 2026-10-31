import importlib.util
from pathlib import Path
import os
import subprocess
import sys

import pytest


def test_t5_cold_import_does_not_query_cuda():
    if importlib.util.find_spec('torch') is None:
        pytest.skip('Requires real CPU or CUDA PyTorch')
    env = dict(os.environ, CUDA_VISIBLE_DEVICES='')
    env['PYTHONPATH'] = str(Path(__file__).resolve().parents[1] / 'app')
    code = '''
import torch
def unexpected_cuda_query():
    raise AssertionError('CUDA was queried during import')
torch.cuda.current_device = unexpected_cuda_query
import models.wan.modules.t5
assert not torch.cuda.is_initialized()
'''
    result = subprocess.run([sys.executable, '-c', code], env=env, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
