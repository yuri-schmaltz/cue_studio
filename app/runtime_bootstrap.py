"""Create the private Python environment used by the Cue Studio desktop host.

This deliberately installs into an application-data directory. The packaged
source tree is read-only and never receives a virtualenv or user settings.
The host calls this script with a validated source directory and a destination
owned by the current user.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import signal
import threading
import time
import venv
from pathlib import Path


def python_executable(root: Path) -> Path:
    return root / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def main() -> int:
    parent = int(os.environ.get('CUE_DESKTOP_PARENT_PID', '0'))
    if parent and os.name == 'posix' and os.getpgrp() == os.getpid():
        def watch_parent():
            while os.getppid() == parent:
                time.sleep(.5)
            os.killpg(os.getpgrp(), signal.SIGTERM)
        threading.Thread(target=watch_parent, daemon=True).start()
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-dir", type=Path, required=True)
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--python", default="3.11", help="Python 3.11 interpreter or uv version request")
    parser.add_argument("--profile", choices=("E0", "E3"), help="CPU tools or NVIDIA CUDA 13 runtime; auto-detected by default")
    parser.add_argument("--check", action="store_true", help="validate the packaged manifest without installing")
    args = parser.parse_args()
    app_dir = args.app_dir.resolve()
    runtime_dir = args.runtime_dir.resolve()
    requirements = app_dir / "requirements.txt"
    manifest_path = app_dir / "runtime_manifest.json"
    if not requirements.is_file() or not manifest_path.is_file():
        raise SystemExit("Cue Studio runtime package is incomplete")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    if digest != manifest.get("requirementsSha256"):
        raise SystemExit("Runtime requirements checksum does not match the packaged manifest")
    if args.check:
        for entry in manifest['locks'].values():
            if hashlib.sha256((app_dir / entry['path']).read_bytes()).hexdigest() != entry['sha256']:
                raise SystemExit('Runtime lock checksum mismatch')
        print(json.dumps({"runtimeVersion": manifest["runtimeVersion"], "requirementsSha256": digest}))
        return 0
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('This release provides a verified Linux x86_64 runtime only')
    for executable in ('git', 'ffmpeg'):
        if not shutil.which(executable):
            raise SystemExit(f'Missing system dependency: {executable}. Install it using your Linux package manager and retry.')
    runtime_dir.mkdir(parents=True, exist_ok=True)
    # The installer tool has its own tiny environment; never modify system Python.
    tools = runtime_dir / 'installer'
    uv = tools / 'bin/uv'
    if not uv.is_file():
        venv.EnvBuilder(with_pip=True).create(tools)
        subprocess.run([str(python_executable(tools)), '-m', 'pip', 'install', 'uv==0.13.6'], check=True)
    profile = args.profile
    if profile is None:
        try:
            result = subprocess.run(['nvidia-smi', '--query-gpu=driver_version', '--format=csv,noheader'],
                                    capture_output=True, text=True, timeout=10)
            drivers = [int(line.split('.')[0]) for line in result.stdout.splitlines() if line.strip()]
            profile = 'E3' if result.returncode == 0 and drivers and min(drivers) >= 580 else 'E0'
        except (OSError, ValueError, subprocess.TimeoutExpired):
            profile = 'E0'
    entry = manifest['locks'][profile]
    lock = app_dir / entry['path']
    lock_hash = hashlib.sha256(lock.read_bytes()).hexdigest()
    if lock_hash != entry['sha256']:
        raise SystemExit('Runtime lock checksum mismatch')
    marker = runtime_dir / 'runtime-ready.json'
    marker.unlink(missing_ok=True)
    wheels = runtime_dir / 'wheels'
    wheel_builder = app_dir / 'runtime_tools/build_decord_wheel.py'
    if not wheel_builder.is_file():
        wheel_builder = app_dir.parent / 'scripts/build_decord_wheel.py'
    subprocess.run([sys.executable, str(wheel_builder),
                    '--output-dir', str(wheels)], check=True)
    env_dir = runtime_dir / "env"
    python = python_executable(env_dir)
    if not python.is_file():
        subprocess.run([str(uv), 'venv', '--python', args.python, str(env_dir)], check=True)
    version = subprocess.check_output([str(python), '-c', 'import sys; print("%s.%s" % sys.version_info[:2])'], text=True).strip()
    if version != '3.11':
        raise SystemExit(f'The locked runtime requires Python 3.11; found {version}')
    subprocess.run([str(uv), 'pip', 'sync', '--python', str(python), '--require-hashes',
                    '--index-strategy', 'unsafe-best-match', '--find-links', str(wheels), str(lock)], check=True)
    subprocess.run([str(uv), 'pip', 'check', '--python', str(python)], check=True)
    subprocess.run([str(python), '-c', 'import torch, decord, fastapi, transformers, cv2, git; print(torch.__version__)'], check=True)
    shutil.copytree(app_dir, runtime_dir / 'app', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('env', 'env-*', '.cache', '__pycache__', 'ckpts',
                                                 'outputs', 'projects', 'loras', 'settings',
                                                 'wgp_config.json', 'setup_config.json', '*.sqlite*', '*.pyc',
                                                 '*.safetensors', '*.gguf', '*.pth', '*.pt', '*.bin'))
    marker.write_text(json.dumps({"runtimeVersion": manifest["runtimeVersion"], "profile": profile,
                                 "python": str(python), "requirementsSha256": digest, "lockSha256": lock_hash}, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
