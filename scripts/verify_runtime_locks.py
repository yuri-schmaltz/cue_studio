#!/usr/bin/env python3
"""Verify versioned runtime locks and their source hashes without installing."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.services.lockfile import parse_requirements


def verify(root: Path) -> list[str]:
    manifest = json.loads((root / "app/locks/source-manifest.json").read_text())
    errors = []
    for name, expected in manifest["source_sha256"].items():
        path = root / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            errors.append(f"Source hash drift: {name}")
    for profile in ("E0", "E1", "E2", "E3", "E4"):
        entry = manifest["profiles"][profile]
        path = root / entry["lock"]
        source = json.loads((root / entry["manifest"]).read_text())
        for field, target in (("lock_sha256", path),
                              ("requirements_txt_sha256", root / "app/requirements.txt"),
                              ("pyproject_sha256", root / "pyproject.toml")):
            if hashlib.sha256(target.read_bytes()).hexdigest() != source[field]:
                errors.append(f"{profile}: {field} drift")
        requirements = parse_requirements(path.read_text())
        if len(requirements) != entry["packages"]:
            errors.append(f"{profile}: package count drift")
        for requirement in requirements:
            if not requirement.hashes or (not requirement.url and (
                not requirement.version_spec.startswith("==")
                or "*" in requirement.version_spec or "," in requirement.version_spec
            )):
                errors.append(f"{profile}: unpinned or unhashed {requirement.name}")
    return errors


if __name__ == "__main__":
    try:
        errors = verify(ROOT)
    except (OSError, KeyError, ValueError) as error:
        errors = [str(error)]
    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print("Runtime locks verified: E0-E4, exact pins, SHA-256 and source manifests")
