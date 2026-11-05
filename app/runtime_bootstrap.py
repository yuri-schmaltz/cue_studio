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
import venv
from pathlib import Path


def python_executable(root: Path) -> Path:
    return root / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-dir", type=Path, required=True)
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--python", type=Path, default=Path(sys.executable))
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
        print(json.dumps({"runtimeVersion": manifest["runtimeVersion"], "requirementsSha256": digest}))
        return 0
    runtime_dir.mkdir(parents=True, exist_ok=True)
    env_dir = runtime_dir / "env"
    python = python_executable(env_dir)
    if not python.is_file():
        if (3, 11) <= sys.version_info[:2] < (3, 13):
            builder = venv.EnvBuilder(with_pip=True, clear=False, symlinks=(os.name != "nt"))
            builder.create(env_dir)
        else:
            uv = shutil.which("uv")
            if not uv:
                raise SystemExit(f"Python 3.11 or 3.12 is required (found {platform.python_version()}); install uv or choose a compatible runtime")
            subprocess.run([uv, "venv", "--python", "3.11", str(env_dir)], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "--requirement", str(requirements)], check=True)
    marker = runtime_dir / "runtime-ready.json"
    marker.write_text(json.dumps({"runtimeVersion": manifest["runtimeVersion"], "python": str(python), "requirementsSha256": digest}, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
