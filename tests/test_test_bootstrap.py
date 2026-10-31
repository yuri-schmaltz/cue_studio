"""The test bootstrap supports lean, CPU-only and working CUDA runtimes."""
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("runtime", ["missing", "cpu", "cuda"])
def test_optional_torch_bootstrap(runtime):
    root = Path(__file__).resolve().parents[1]
    script = '''
import importlib.abc
import runpy
import sys
import types

runtime, bootstrap = sys.argv[1:]
if runtime == "missing":
    class NoTorch(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname.split(".")[0] in ("torch", "torchvision"):
                raise ModuleNotFoundError(fullname)
    sys.meta_path.insert(0, NoTorch())
else:
    torch = types.ModuleType("torch")
    torch.__path__ = []
    cuda = types.ModuleType("torch.cuda")
    cuda.is_available = lambda: runtime == "cuda"
    cuda.current_device = lambda: 7
    torch.cuda = cuda
    sys.modules.update({"torch": torch, "torch.cuda": cuda})

runpy.run_path(bootstrap)
import torch
if runtime == "missing":
    assert not torch.cuda.is_available()
elif runtime == "cpu":
    assert torch.cuda.current_device() == 0
    assert not torch.cuda.is_available()
else:
    assert torch.cuda.current_device() == 7
    assert torch.cuda.is_available()
'''
    result = subprocess.run(
        [sys.executable, "-c", script, runtime, str(root / "conftest.py")],
        cwd=root, text=True, capture_output=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
