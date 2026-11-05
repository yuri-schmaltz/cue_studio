"""Update packaged Python source independently of its managed dependencies.

Only files named in the packaged manifest are touched. Models, environment,
projects and user settings are not part of that manifest.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile


def sync_source(source: Path, destination: Path) -> bool:
    source = source.resolve()
    destination = destination.resolve()
    manifest_bytes = (source / 'runtime-code-manifest.json').read_bytes()
    revision = hashlib.sha256(manifest_bytes).hexdigest()
    marker = destination / '.runtime-code-revision'
    if marker.is_file() and marker.read_text().strip() == revision:
        return False
    manifest = json.loads(manifest_bytes)
    if manifest.get('schema') != 1 or not isinstance(manifest.get('files'), dict):
        raise ValueError('Invalid packaged source manifest')
    # Validate every source before replacing any destination file.
    files = []
    for relative, expected in manifest['files'].items():
        path = Path(relative)
        if path.is_absolute() or not path.parts or '..' in path.parts:
            raise ValueError('Invalid packaged source path')
        src = (source / path).resolve()
        dst = destination / path
        if not src.is_relative_to(source) or not dst.resolve().is_relative_to(destination):
            raise ValueError('Packaged source path escapes runtime')
        if hashlib.sha256(src.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Packaged source checksum mismatch: {relative}')
        files.append((src, dst))
    destination.mkdir(parents=True, exist_ok=True)
    for src, dst in files:
        dst.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=dst.parent, delete=False) as handle:
            tmp = Path(handle.name)
            try:
                handle.write(src.read_bytes())
                handle.flush()
                os.fchmod(handle.fileno(), src.stat().st_mode & 0o777)
            except BaseException:
                tmp.unlink(missing_ok=True)
                raise
        os.replace(tmp, dst)
    temp_marker = destination / '.runtime-code-revision.tmp'
    temp_marker.write_text(revision + '\n')
    os.replace(temp_marker, marker)
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    print('Source updated' if sync_source(args.source, args.destination) else 'Source current')
